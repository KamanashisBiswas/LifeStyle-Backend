/**
 * ============================================================
 * controllers/orderController.js — Online Order Management
 * ============================================================
 * Customer website থেকে আসা online order এবং Admin/Employee দ্বারা তৈরি order handle করে।
 *
 * API Endpoints:
 *  POST /api/order               → createOrder()          — Customer online order place
 *  POST /api/order/admin-create  → createOrderByAdmin()   — Admin/Employee কাউন্টার থেকে order
 *  GET  /api/order               → getAllOrders()          — Admin: সব orders (filter/pagination)
 *  GET  /api/order/my-orders     → getMyOrders()          — Customer নিজের orders
 *  GET  /api/order/:id           → getOrderById()         — একটি order দেখা
 *  PUT  /api/order/:id/status    → updateOrderStatus()    — order status update (Admin)
 *  DELETE /api/order/:id         → deleteOrder()          — delete (Admin only)
 *
 * Order create process:
 *  1. প্রতি product ঊর stock যাচাই
 *  2. Stock কাটানো হয়
 *  3. Order সাভ
 *  4. Customer কে SMS confirmation পাঠানো হয় (non-blocking)
 * ============================================================
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer"); // Import Customer model
const Return = require("../models/Return");
const Exchange = require("../models/Exchange");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const axios = require("axios");
const mongoose = require("mongoose");
const inventoryService = require("../services/inventoryService");
const { generateCustomId } = require("../utils/customIdGenerator");

// @desc    Create a new order
// @route   POST /api/order
// @access  Private
const createOrder = asyncHandler(async (req, res, next) => {
  const {
    customerName,
    address,
    phone,
    products,
    subtotal,
    shippingFee,
    shippingArea,
    totalAmount,
    couponCode, // Add this
    discountAmount, // Add this
    pointsToRedeem, // Reward points to redeem (min 100 points, 1 pt = ৳1)
  } = req.body;

  let pointsRedeemedNum = 0;
  let pointDiscount = 0;
  let finalTotalAmount = Number(totalAmount) || 0;
  let updatedCustomerPoints = undefined;

  // --- Reward Points Redemption Logic ---
  if (pointsToRedeem && Number(pointsToRedeem) > 0) {
    const pointsNum = Math.floor(Number(pointsToRedeem));
    if (pointsNum < 100) {
      return res.status(400).json({
        success: false,
        message: "Minimum 100 reward points required to redeem.",
      });
    }

    const customerDoc = await Customer.findById(req.customer.id);
    if (!customerDoc) {
      return res.status(404).json({
        success: false,
        message: "Customer account not found.",
      });
    }

    if ((customerDoc.rewardPoints || 0) < pointsNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient reward points. You have ${customerDoc.rewardPoints || 0} points, tried to redeem ${pointsNum}.`,
      });
    }

    // Conversion rate: 1 point = ৳1 discount
    pointDiscount = pointsNum * 1;
    const maxDiscountAllowed = Math.max(
      0,
      Number(subtotal || 0) + Number(shippingFee || 0) - Number(discountAmount || 0),
    );
    if (pointDiscount > maxDiscountAllowed) {
      pointDiscount = maxDiscountAllowed;
      pointsRedeemedNum = Math.ceil(pointDiscount / 1);
    } else {
      pointsRedeemedNum = pointsNum;
    }

    // Deduct points from customer
    customerDoc.rewardPoints = Math.max(0, (customerDoc.rewardPoints || 0) - pointsRedeemedNum);
    await customerDoc.save();
    updatedCustomerPoints = customerDoc.rewardPoints;

    finalTotalAmount = Math.max(
      0,
      Number(subtotal || 0) + Number(shippingFee || 0) - Number(discountAmount || 0) - pointDiscount,
    );
  }

  // Pre-generate custom orderId
  const customOrderId = await generateCustomId("ORD", Order, "orderId", "Order");

  // Atomic Inventory Deduction & Order Creation via Mongoose Session
  const session = await mongoose.startSession();
  session.startTransaction();
  let order;

  try {
    const { processedItems } = await inventoryService.deductForOnlineOrder({
      orderId: customOrderId,
      items: products.map((item) => ({
        productId: item.productId,
        variationId: item.variationId,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
      })),
      user: req.customer,
      session,
    });

    const enrichedProducts = products.map((item, idx) => ({
      ...item,
      productIdCode: processedItems[idx]?.productIdCode || "",
      purchasePrice: processedItems[idx]?.purchasePrice || 0,
      deductions: processedItems[idx]?.deductions || [],
    }));

    const [createdOrder] = await Order.create(
      [
        {
          orderId: customOrderId,
          customer: req.customer.id,
          customerName,
          address,
          phone,
          products: enrichedProducts,
          subtotal,
          shippingFee,
          shippingArea,
          totalAmount: finalTotalAmount,
          couponCode,
          discountAmount,
          pointsRedeemed: pointsRedeemedNum,
          pointsDiscount: pointDiscount,
          orderType: "online", // Online order
        },
      ],
      { session },
    );

    order = createdOrder;
    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(err.code === "INSUFFICIENT_STOCK" ? 400 : 500).json({
      success: false,
      message: err.message,
      errorCode: err.code || "ORDER_CREATION_FAILED",
      details: err.details || null,
    });
  }

  // Send confirmation SMS (non-blocking)
  (async () => {
    try {
      const msg = `Dear ${customerName}, your order ${order.orderId} has been placed successfully. Total: ৳${finalTotalAmount}. Thanks for shopping with LifeStyle. Visit: https://shoppersperklifestyle.com/`;
      const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
        process.env.BULK_SMS_API_KEY
      }&senderid=${
        process.env.BULK_SMS_SENDER_ID
      }&number=${phone}&message=${encodeURIComponent(msg)}`;
      const resp = await axios.get(apiUrl);
      if (resp?.data?.response_code !== 202) {
        console.error("Order SMS failed:", resp?.data);
      }
    } catch (e) {
      console.error("Order SMS error:", e?.response?.data || e.message);
    }
  })();

  res.status(201).json({
    success: true,
    data: order,
    customerRewardPoints: updatedCustomerPoints,
  });
});

// @desc    Create a new order by Admin/Employee
// @route   POST /api/order/admin-create
// @access  Private (Admin, Employee)
const createOrderByAdmin = asyncHandler(async (req, res, next) => {
  const {
    customerName,
    address,
    phone,
    products,
    subtotal,
    shippingFee,
    shippingArea,
    totalAmount,
    couponCode, // Add this
    discountAmount, // Add this
    paymentStatus, // 'COD' or 'Paid'
  } = req.body;

  // 1. Validate required fields
  if (
    !customerName ||
    !address ||
    !phone ||
    !products ||
    products.length === 0
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide all required fields" });
  }

  // 2. Find or create customer by exact name + phone match
  const normName = customerName.trim();
  const normPhone = phone.trim();

  let cust = await Customer.findOne({
    phone: normPhone,
    name: { $regex: new RegExp(`^${normName}$`, "i") }
  });

  if (!cust) {
    cust = await Customer.create({
      name: normName,
      phone: normPhone,
      password: "N/A"
    });
  }

  // Pre-generate custom orderId
  const customOrderId = await generateCustomId("ORD", Order, "orderId", "Order");

  // 3. Atomic Inventory Deduction & Order Creation via Mongoose Session
  const session = await mongoose.startSession();
  session.startTransaction();
  let order;

  try {
    const { processedItems } = await inventoryService.deductForOnlineOrder({
      orderId: customOrderId,
      items: products.map((item) => ({
        productId: item.productId,
        variationId: item.variationId,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
      })),
      user: req.user,
      session,
    });

    const enrichedProducts = products.map((item, idx) => {
      const origP = item.originalPrice || item.price;
      const itemDisc = item.itemDiscount !== undefined ? Number(item.itemDiscount) : (origP > item.price ? origP - item.price : 0);
      return {
        ...item,
        productIdCode: processedItems[idx]?.productIdCode || "",
        originalPrice: origP,
        itemDiscount: itemDisc,
        purchasePrice: processedItems[idx]?.purchasePrice || 0,
        deductions: processedItems[idx]?.deductions || [],
      };
    });

    const [createdOrder] = await Order.create(
      [
        {
          orderId: customOrderId,
          customer: cust._id,
          customerName,
          address,
          phone,
          products: enrichedProducts,
          subtotal,
          shippingFee,
          shippingArea,
          totalAmount,
          couponCode,
          discountAmount,
          paymentStatus: paymentStatus === "Paid" ? "Paid" : "COD",
          createdBy: req.user.id,
          orderType: "online", // Online / Manual order created by Admin
        },
      ],
      { session },
    );

    order = createdOrder;
    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(err.code === "INSUFFICIENT_STOCK" ? 400 : 500).json({
      success: false,
      message: err.message,
      errorCode: err.code || "ADMIN_ORDER_CREATION_FAILED",
      details: err.details || null,
    });
  }

  // 4. Send confirmation SMS (optional, but good to have)
  (async () => {
    try {
      const msg = `Dear ${customerName}, your order ${order.orderId} has been placed by our team. Total: ৳${totalAmount}. Thanks for choosing LifeStyle. Visit: https://shoppersperklifestyle.com/`;
      const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
        process.env.BULK_SMS_API_KEY
      }&senderid=${
        process.env.BULK_SMS_SENDER_ID
      }&number=${phone}&message=${encodeURIComponent(msg)}`;
      await axios.get(apiUrl);
    } catch (e) {
      console.error("Admin Order SMS error:", e?.response?.data || e.message);
    }
  })();

  logActivity({
    req,
    action: "CREATE_ORDER",
    entityType: "Order",
    entityId: order.orderId || order._id,
    description: `Created new order ${order.orderId || ""} for customer '${customerName}' (Total: ৳${totalAmount})`,
    metadata: { orderId: order.orderId, customerName, phone, totalAmount }
  });

  res.status(201).json({
    success: true,
    message: "Order created successfully by admin.",
    data: order,
  });
});

/**
 * Helper to attach Return and Exchange details, update product flags, and prioritize order status
 */
const attachReturnsAndExchangesToOrders = async (orderList) => {
  if (!orderList || orderList.length === 0) return orderList;

  const orderIds = orderList.map((o) => o._id);

  const [allReturns, allExchanges] = await Promise.all([
    Return.find({
      order: { $in: orderIds },
      status: { $in: ["received", "refunded", "approved", "pending"] },
    })
      .populate("product", "name productId images")
      .lean(),
    Exchange.find({
      order: { $in: orderIds },
    })
      .populate("originalProduct", "name productId images")
      .populate("originalItems.originalProduct", "name productId images")
      .populate("replacementProduct", "name productId images bannerImage")
      .populate(
        "replacementItems.replacementProduct",
        "name productId images bannerImage",
      )
      .lean(),
  ]);

  return orderList.map((order) => {
    const oIdStr = order._id.toString();
    const orderReturns = allReturns.filter(
      (r) => r.order && r.order.toString() === oIdStr,
    );
    const orderExchanges = allExchanges.filter(
      (exc) => exc.order && exc.order.toString() === oIdStr,
    );

    let totalReturnedQty = 0;
    let totalExchangedQty = 0;
    let totalOrderQty = 0;

    if (order.products && Array.isArray(order.products)) {
      order.products = order.products.map((product) => {
        const prodIdStr =
          product.productId?._id?.toString() ||
          product.productId?.toString() ||
          "";
        const prodSize = (product.size || "").trim();
        const prodColor = (product.color || "").trim();
        const orderedQty = Number(product.quantity) || 1;
        totalOrderQty += orderedQty;

        // Match returns
        const productReturns = orderReturns.filter((r) => {
          const rProdId =
            r.product?._id?.toString() || r.product?.toString() || "";
          const rSize = (r.productSize || "").trim();
          const rColor = (r.productColor || "").trim();
          const idMatch = rProdId && prodIdStr && rProdId === prodIdStr;
          const codeMatch =
            r.productIdCode &&
            product.productIdCode &&
            r.productIdCode === product.productIdCode;
          const nameMatch =
            r.productName &&
            product.name &&
            r.productName.trim().toLowerCase() === product.name.trim().toLowerCase();
          return (
            (idMatch || codeMatch || nameMatch) &&
            (!rSize || !prodSize || rSize === prodSize) &&
            (!rColor || !prodColor || rColor === prodColor)
          );
        });

        const returnedQty = productReturns.reduce(
          (sum, r) => sum + (Number(r.quantity) || 1),
          0,
        );
        totalReturnedQty += returnedQty;

        // Match exchanges
        const productExchanges = orderExchanges.filter((exc) => {
          if (Array.isArray(exc.originalItems) && exc.originalItems.length > 0) {
            return exc.originalItems.some((orig) => {
              const origId =
                orig.originalProduct?._id?.toString() ||
                orig.originalProduct?.toString() ||
                "";
              const origSize = (orig.originalProductSize || "").trim();
              const origColor = (orig.originalProductColor || "").trim();
              const idMatch = origId && prodIdStr && origId === prodIdStr;
              const codeMatch =
                orig.originalProductIdCode &&
                product.productIdCode &&
                orig.originalProductIdCode === product.productIdCode;
              const nameMatch =
                orig.originalProductName &&
                product.name &&
                orig.originalProductName.trim().toLowerCase() ===
                  product.name.trim().toLowerCase();
              return (
                (idMatch || codeMatch || nameMatch) &&
                (!origSize || !prodSize || origSize === prodSize) &&
                (!origColor || !prodColor || origColor === prodColor)
              );
            });
          }
          const origId =
            exc.originalProduct?._id?.toString() ||
            exc.originalProduct?.toString() ||
            "";
          return origId && prodIdStr && origId === prodIdStr;
        });

        const exchangedQty = productExchanges.reduce((sum, exc) => {
          if (Array.isArray(exc.originalItems) && exc.originalItems.length > 0) {
            return (
              sum +
              exc.originalItems.reduce(
                (itemSum, orig) => itemSum + (Number(orig.quantity) || 1),
                0,
              )
            );
          }
          return sum + (Number(exc.exchangeQuantity) || 1);
        }, 0);
        totalExchangedQty += exchangedQty;

        return {
          ...product,
          returnedQuantity: returnedQty,
          exchangedQuantity: exchangedQty,
          isReturned: returnedQty >= orderedQty && orderedQty > 0,
          isPartiallyReturned: returnedQty > 0 && returnedQty < orderedQty,
          isExchanged: exchangedQty >= orderedQty && orderedQty > 0,
          isPartiallyExchanged: exchangedQty > 0 && exchangedQty < orderedQty,
          exchangeHistory: productExchanges,
        };
      });
    }

    order.hasReturns = orderReturns.length > 0;
    order.hasExchanges = orderExchanges.length > 0;
    order.returnsCount = orderReturns.length;
    order.exchangesCount = orderExchanges.length;
    order.returns = orderReturns;
    order.exchanges = orderExchanges;

    // Prioritize status display: Returns > Exchanges > Original Order Status
    if (order.status !== "cancelled") {
      if (orderReturns.length > 0 || totalReturnedQty > 0) {
        if (totalReturnedQty >= totalOrderQty && totalOrderQty > 0) {
          order.status = "Returned";
        } else {
          order.status = "Partially Returned";
        }
      } else if (orderExchanges.length > 0 || totalExchangedQty > 0) {
        if (totalExchangedQty >= totalOrderQty && totalOrderQty > 0) {
          order.status = "Exchanged";
        } else {
          order.status = "Partially Exchanged";
        }
      }
    }

    order.orderType =
      order.orderType || (order.address === "POS Sale" ? "shop" : "online");

    return order;
  });
};

// @desc    Get all order
// @route   GET /api/order
// @access  Private/Admin
const getAllOrders = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    status,
    search,
    pagination,
    period,
    specificDate,
    startDate,
    endDate,
  } = req.query;

  // Build query - Exclude shop orders (POS sales)
  const query = {
    address: { $ne: "POS Sale" }, // Exclude shop orders
  };

  // Add date range filter based on filter mode
  if (specificDate) {
    // Filter by specific date (entire day)
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);

    query.createdAt = {
      $gte: dateObj,
      $lt: nextDate,
    };
  } else if (startDate || endDate) {
    // Filter by date range
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1); // Include entire end date
      query.createdAt.$lt = endDateObj;
    }
  } else if (period) {
    // Filter by predefined period
    const now = new Date();
    let periodStartDate;

    switch (period) {
      case "daily":
        // Today's orders
        periodStartDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        break;
      case "weekly":
        // Last 7 days
        periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        // Current month
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        // Current year
        periodStartDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        periodStartDate = null;
    }

    if (periodStartDate) {
      query.createdAt = { $gte: periodStartDate };
    }
  }

  // Add status filter if provided
  if (status && status !== "all") {
    query.status = status;
  }

  // Add search filter for orderId or customerName
  if (search) {
    query.$or = [
      { orderId: { $regex: search, $options: "i" } },
      { customerName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  // Get all matching orders to calculate stats for the entire filtered set
  const allOrdersForStats = await Order.find(query).lean();

  // Exclude cancelled and returned orders from valid sales
  const validOrders = allOrdersForStats.filter(
    (order) =>
      order.status !== "cancelled" &&
      order.status !== "returned" &&
      order.status !== "refunded"
  );

  const totalGrossSales = validOrders.reduce(
    (sum, order) => sum + (order.totalAmount || 0),
    0
  );
  const totalShippingFee = validOrders.reduce(
    (sum, order) => sum + (order.shippingFee || 0),
    0
  );
  const totalSubtotal = validOrders.reduce(
    (sum, order) => sum + (order.subtotal || 0),
    0
  );
  const totalDiscount = validOrders.reduce(
    (sum, order) => sum + (order.discountAmount || 0),
    0
  );

  // Calculate returns and cancellations
  const returnedOrders = allOrdersForStats.filter(
    (order) =>
      order.status === "returned" ||
      order.status === "partial-returned" ||
      order.status === "refunded"
  );
  const cancelledOrders = allOrdersForStats.filter(
    (order) => order.status === "cancelled"
  );

  // Fetch online return records from Return collection for these orders
  // (Only finalized refunded returns are counted in stats and deducted from sales)
  const validOrderIds = allOrdersForStats.map((o) => o._id);
  const returnRecords = await Return.find({
    order: { $in: validOrderIds },
    reason: { $ne: "Shop Return" },
    status: "refunded",
  })
    .populate("order", "products totalAmount subtotal")
    .lean();

  const totalReturns = returnRecords.length > 0 ? returnRecords.length : returnedOrders.length;
  const totalReturnValue = returnRecords.length > 0 
    ? returnRecords.reduce((sum, r) => {
        let val = Number(r.refundAmount || 0);
        if (val === 0 && r.order && Array.isArray(r.order.products)) {
          const matchedItem = r.order.products.find(
            (p) =>
              (r.product && p.productId && p.productId.toString() === r.product.toString()) ||
              (r.productName && p.name && p.name.trim().toLowerCase() === r.productName.trim().toLowerCase())
          );
          if (matchedItem) {
            const ratio = (r.order.subtotal || 0) > 0 ? (r.order.totalAmount || 0) / r.order.subtotal : 1;
            val = (Number(matchedItem.price) || 0) * (Number(r.quantity) || 1) * ratio;
          }
        }
        return sum + val;
      }, 0)
    : returnedOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  const totalCancelled = cancelledOrders.length;
  const totalCancelledValue = cancelledOrders.reduce(
    (sum, order) => sum + (order.totalAmount || 0),
    0
  );

  // Formula: Net Total Sales = Total Gross Sell - Shipping Fee - Return Value
  const totalSales = Math.max(0, totalGrossSales - totalShippingFee - totalReturnValue);

  const productIdsToFetch = [];
  validOrders.forEach((o) => {
    (o.products || []).forEach((p) => {
      if (p.productId) productIdsToFetch.push(p.productId);
    });
  });
  const dbProductsList = await Product.find({ _id: { $in: productIdsToFetch } }).lean();
  const dbProductMap = new Map(dbProductsList.map((prod) => [prod._id.toString(), prod]));

  let totalPurchasePrice = 0;
  let totalProfit = 0;
  // Calculate purchase price and profit only from valid orders (exclude cancelled and returned)
  validOrders.forEach((order) => {
    if (order.products && Array.isArray(order.products)) {
      order.products.forEach((product) => {
        let purchasePrice = Number(product.purchasePrice) || 0;
        if (purchasePrice === 0 && product.productId) {
          const dbProd = dbProductMap.get(product.productId.toString());
          if (dbProd && Array.isArray(dbProd.variation)) {
            const matchedVar = dbProd.variation.find(
              (v) =>
                (v.size === product.size || (!v.size && !product.size)) &&
                (v.color === product.color || (!v.color && !product.color)),
            );
            if (matchedVar) {
              purchasePrice = Number(matchedVar.purchasePrice) || 0;
            } else if (dbProd.variation[0]) {
              purchasePrice = Number(dbProd.variation[0].purchasePrice) || 0;
            }
          }
        }
        const sellingPrice = Number(product.price) || 0;
        const quantity = Number(product.quantity) || 0;
        totalPurchasePrice += purchasePrice * quantity;
        totalProfit += (sellingPrice - purchasePrice) * quantity;
      });
    }
  });

  // Subtract return value and discounts from totalProfit if applicable
  const netCalculatedProfit = Math.max(0, totalSales - totalPurchasePrice);

  const isAdmin = req.user?.role === "admin";

  const stats = {
    totalOrders: validOrders.length,
    totalGrossSales,
    totalShippingFee,
    totalSales,
    totalSubtotal,
    totalDiscount,
    ...(isAdmin ? { totalPurchasePrice, totalProfit: netCalculatedProfit } : {}),
    totalReturns,
    totalReturnValue,
    totalCancelled,
    totalCancelledValue,
  };

  if (pagination === "false") {
    orders = await Order.find(query)
      .populate("customer", "name phone")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
    totalOrders = orders.length;

    orders = await attachReturnsAndExchangesToOrders(orders);

    // Strip purchase prices if non-admin
    if (!isAdmin) {
      orders.forEach((o) => {
        if (o.products && Array.isArray(o.products)) {
          o.products.forEach((p) => delete p.purchasePrice);
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: orders,
      stats,
    });
  }

  // Calculate pagination values
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitValue = parseInt(limit);

  // Get total count
  totalOrders = await Order.countDocuments(query);
  const totalPages = Math.ceil(totalOrders / limitValue);

  // Fetch orders
  orders = await Order.find(query)
    .populate("customer", "name phone")
    .populate("products.productId", "name productId images")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitValue)
    .lean();

  orders = await attachReturnsAndExchangesToOrders(orders);

  // Strip purchase prices if non-admin
  if (!isAdmin) {
    orders.forEach((o) => {
      if (o.products && Array.isArray(o.products)) {
        o.products.forEach((p) => delete p.purchasePrice);
      }
    });
  }

  res.status(200).json({
    success: true,
    data: orders,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalOrders,
      total: totalOrders,
      totalItems: totalOrders,
      limit: limitValue,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1,
    },
    stats,
  });
});

// @desc    Get logged-in user's orders with pagination and filtering
// @route   GET /api/order/my-orders?page=1&limit=10&status=pending
// @access  Private
const getMyOrders = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10, status, orderType } = req.query;

  // Fetch the customer to get the latest reward points & phone
  const customer = await Customer.findById(req.customer.id)
    .select("rewardPoints phone")
    .lean();

  // This check is a safeguard; middleware should prevent this.
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  // Customer matching conditions (by ObjectId or Phone for counter POS sales)
  const customerConditions = [{ customer: req.customer.id }];
  if (customer.phone) {
    const trimmedPhone = String(customer.phone).trim();
    const rawPhone = trimmedPhone.replace(/^(\+88|88)/, "");
    customerConditions.push({ phone: trimmedPhone });
    customerConditions.push({ phone: rawPhone });
    customerConditions.push({ phone: `+88${rawPhone}` });
    customerConditions.push({ phone: `88${rawPhone}` });
  }

  const queryConditions = [{ $or: customerConditions }];

  // Filter by orderType: 'online', 'shop', or 'all' (default: all)
  if (orderType === "online") {
    queryConditions.push({
      orderType: { $ne: "shop" },
      address: { $ne: "POS Sale" },
    });
  } else if (orderType === "shop") {
    queryConditions.push({
      $or: [{ orderType: "shop" }, { address: "POS Sale" }],
    });
  }

  // Add status filter if provided
  if (status && status !== "all") {
    queryConditions.push({ status });
  }

  const query = queryConditions.length > 1 ? { $and: queryConditions } : queryConditions[0];

  // Calculate pagination values
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitValue = parseInt(limit);

  // Get total count for pagination metadata
  const totalOrders = await Order.countDocuments(query);
  const totalPages = Math.ceil(totalOrders / limitValue);

  // Fetch orders with pagination
  let orders = await Order.find(query)
    .populate("products.productId", "name productId images")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitValue)
    .lean(); // Use lean() for better performance

  orders = await attachReturnsAndExchangesToOrders(orders);

  // Attach customer reviews to products in orders
  try {
    const Review = require("../models/Review");
    const customerReviews = await Review.find({ customer: customer._id })
      .populate("product", "productId")
      .lean();
    if (customerReviews.length > 0) {
      const reviewByProd = new Map();
      customerReviews.forEach((rev) => {
        if (rev.product) {
          const pId = rev.product._id ? String(rev.product._id) : String(rev.product);
          reviewByProd.set(pId, rev);
          if (rev.product.productId) {
            reviewByProd.set(String(rev.product.productId), rev);
          }
        }
      });

      orders.forEach((ord) => {
        if (Array.isArray(ord.products)) {
          ord.products.forEach((p) => {
            const rawId = p.productId?._id
              ? String(p.productId._id)
              : p.productId
              ? String(p.productId)
              : null;
            const code = p.productIdCode || (p.productId && p.productId.productId ? String(p.productId.productId) : null);
            const foundReview = (rawId && reviewByProd.get(rawId)) || (code && reviewByProd.get(code)) || null;
            if (foundReview) {
              p.review = foundReview;
              p.hasReviewed = true;
            } else {
              p.hasReviewed = false;
            }
          });
        }
      });
    }
  } catch (revErr) {
    console.error("Error attaching reviews to customer orders:", revErr);
  }

  res.status(200).json({
    success: true,
    count: orders.length,
    rewardPoints: customer.rewardPoints, // Include reward points in the response
    data: orders,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalOrders,
      limit: limitValue,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1,
    },
  });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private/Admin
const getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate("customer", "name phone") // Changed from "user" to "customer"
    .populate("products.productId", "name productId images")
    .lean();

  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Order not found with id of ${req.params.id}`,
    });
  }

  const [processedOrder] = await attachReturnsAndExchangesToOrders([order]);

  res.status(200).json({
    success: true,
    data: processedOrder,
  });
});

/**
 * @desc    Get all orders for a specific customer by their ID
 * @route   GET /api/order/by-customer/:customerId
 * @access  Private (Admin, Employee)
 */
const getOrdersByCustomerId = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  const { page = 1, limit = 5, orderType } = req.query; // Default to page 1, 5 items per page

  const query = { customer: customerId };
  if (orderType === "shop") {
    query.$or = [{ orderType: "shop" }, { address: "POS Sale" }];
  } else if (orderType === "all") {
    // Return all orders for this customer
  } else {
    // Default: Online orders tab only shows genuine online orders
    query.orderType = { $ne: "shop" };
    query.address = { $ne: "POS Sale" };
  }

  const limitValue = parseInt(limit);
  const skip = (parseInt(page) - 1) * limitValue;

  const totalOrders = await Order.countDocuments(query);
  const totalPages = Math.ceil(totalOrders / limitValue);

  // Find orders where the customer field matches the provided customerId
  const orders = await Order.find(query)
    .sort({ updatedAt: -1, createdAt: -1 }) // Sort by most recent
    .skip(skip)
    .limit(limitValue)
    .lean();

  res.status(200).json({
    success: true,
    count: orders.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalOrders,
      limit: limitValue,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1,
    },
    data: orders,
  });
});

// @desc    Update order status and details (with role-based access control)
// @route   PUT /api/orders/:id/status
// @access  Private (Admin, Employee, Manager)
const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const {
    status,
    customerName,
    phone,
    address,
    shippingArea,
    shippingFee,
    paymentStatus,
    isDeliveryChargePaid,
    note,
  } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Order not found with id of ${req.params.id}`,
    });
  }

  const previousStatus = order.status || "pending"; // track previous
  const userRole = (req.user?.role || "user").toLowerCase();

  const isPostShippingStatus = [
    "shipping",
    "shipped",
    "delivered",
    "cancelled",
    "returned",
    "refunded",
    "partial-returned",
  ].includes((previousStatus || "").toLowerCase());

  // --- Role-Based Field Updates ---
  // Manager: Can ONLY update status, address, shippingArea (delivery inside/outside dhaka)
  // Admin & Employee: Can update all order info (customerName, phone, address, shippingArea, paymentStatus, note, isDeliveryChargePaid)
  if (address !== undefined && address.trim()) {
    if (isPostShippingStatus && address.trim() !== (order.address || "").trim()) {
      return res.status(400).json({
        success: false,
        message: `Order status '${previousStatus}' অবস্থায় ডেলিভারি অ্যাড্রেস পরিবর্তন করা যাবে না (Delivery address cannot be edited once order is in shipping or beyond).`,
      });
    }
    if (!isPostShippingStatus) {
      order.address = address.trim();
    }
  }

  if (isDeliveryChargePaid !== undefined) {
    const nextVal = Boolean(isDeliveryChargePaid);

    // Rule: Once marked as paid, Manager cannot turn it off (only Admin/Employee can turn it off)
    if (order.isDeliveryChargePaid && !nextVal && userRole === "manager") {
      return res.status(403).json({
        success: false,
        message: "Managers cannot turn off advanced delivery charge once marked as paid. Only Admin can modify it.",
      });
    }

    if (nextVal) {
      order.isDeliveryChargePaid = true;
      if (!order.deliveryChargePaidByName) {
        order.deliveryChargePaidBy = req.user?._id || null;
        order.deliveryChargePaidByName = req.user?.name || req.user?.username || (userRole === "manager" ? "Manager" : "Admin");
        order.deliveryChargePaidAt = new Date();
      }
    } else {
      order.isDeliveryChargePaid = false;
      order.deliveryChargePaidBy = null;
      order.deliveryChargePaidByName = "";
      order.deliveryChargePaidAt = null;
    }
  }

  if (shippingArea !== undefined && ["Inside Dhaka", "Outside Dhaka"].includes(shippingArea)) {
    const oldArea = order.shippingArea;
    if (shippingArea !== oldArea) {
      if (isPostShippingStatus) {
        return res.status(400).json({
          success: false,
          message: `Order status '${previousStatus}' অবস্থায় ডেলিভারি এরিয়া পরিবর্তন করা যাবে না (Shipping area cannot be changed once order is in shipping or beyond).`,
        });
      }
      order.shippingArea = shippingArea;
      
      // Automatically adjust shippingFee and totalAmount if shippingArea changed
      const newShippingFee = shippingArea === "Inside Dhaka" ? 80 : 150;
      order.shippingFee = newShippingFee;
      order.totalAmount = Math.max(0, (order.subtotal || 0) - (order.discountAmount || 0) + newShippingFee);
    }
  }

  // Admin and Employee can update customer info and paymentStatus
  if (["admin", "employee"].includes(userRole)) {
    if (customerName !== undefined && customerName.trim()) {
      order.customerName = customerName.trim();
    }
    if (phone !== undefined && phone.trim()) {
      order.phone = phone.trim();
    }
    if (shippingFee !== undefined && Number(shippingFee) >= 0) {
      order.shippingFee = Number(shippingFee);
      order.totalAmount = Math.max(0, (order.subtotal || 0) - (order.discountAmount || 0) + Number(shippingFee));
    }
    if (paymentStatus !== undefined && ["COD", "Paid"].includes(paymentStatus)) {
      order.paymentStatus = paymentStatus;
    }
  }

  if (note !== undefined) {
    order.note = note.trim();
  }

  // --- Strict Step-by-Step Transition Validation (if status is provided and changed) ---
  if (status && status !== previousStatus) {
    const allowedTransitions = {
      pending: ["pending", "received", "cancelled"],
      received: ["received", "shipping", "cancelled"],
      shipping: ["shipping", "delivered", "cancelled", "returned", "partial-returned"],
      delivered: ["delivered"],
      cancelled: ["cancelled"],
      returned: ["returned"],
      "partial-returned": ["partial-returned"],
      refunded: ["refunded"],
    };

    const allowedNext = allowedTransitions[previousStatus] || [previousStatus];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from "${previousStatus}" to "${status}". Orders must follow step-by-step progression (Pending -> Received -> Shipped -> Delivered) and cannot revert to a previous status.`,
      });
    }

    // --- Reward Points Logic ---
    // Award points only when moving to 'delivered' status for the first time
    if (
      status === "delivered" &&
      previousStatus !== "delivered" &&
      order.customer
    ) {
      // Rule: 1 point for every ৳100 spent.
      const points = Math.floor(order.totalAmount / 100);
      if (points > 0) {
        order.pointsEarned = points;
        // Atomically update the customer's reward points
        await Customer.findByIdAndUpdate(order.customer, {
          $inc: { rewardPoints: points },
        });
      }
    }

    // Return stock if cancelled newly - ONLY for online orders
    if (
      status === "cancelled" &&
      order.status !== "cancelled" &&
      order.orderType === "online"
    ) {
      const cancelSession = await mongoose.startSession();
      cancelSession.startTransaction();
      try {
        await inventoryService.restoreOnlineCancellation({
          order,
          user: req.user,
          session: cancelSession,
        });
        await cancelSession.commitTransaction();
        cancelSession.endSession();
      } catch (err) {
        await cancelSession.abortTransaction();
        cancelSession.endSession();
        return res.status(err.code === "HISTORICAL_ALLOCATION_REQUIRED" ? 400 : 500).json({
          success: false,
          errorCode: err.code || "CANCELLATION_RESTORE_ERROR",
          message: err.message,
          details: err.details || null,
        });
      }
    }

    // Restore redeemed reward points if cancelled or returned
    if (
      (status === "cancelled" || status === "returned") &&
      previousStatus !== "cancelled" &&
      previousStatus !== "returned" &&
      order.pointsRedeemed > 0 &&
      order.customer
    ) {
      await Customer.findByIdAndUpdate(order.customer, {
        $inc: { rewardPoints: order.pointsRedeemed },
      });
    }

    order.status = status;
  }
  await order.save();

  // Send SMS for specific transitions (non-blocking)
  (async () => {
    try {
      if (previousStatus !== status) {
        const phone = order.phone;
        if (status === "shipping") {
          const msg = `Dear ${order.customerName}, your order ${order.orderId} is now being shipped. We will deliver it soon. Thank you for choosing LifeStyle. Visit: https://shoppersperklifestyle.com/`;
          const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
            process.env.BULK_SMS_API_KEY
          }&senderid=${
            process.env.BULK_SMS_SENDER_ID
          }&number=${phone}&message=${encodeURIComponent(msg)}`;
          await axios.get(apiUrl);
        }
        if (status === "cancelled") {
          const msg = `Dear ${order.customerName}, your order ${order.orderId} has been cancelled. If this wasn't you, please contact our support. Visit: https://shoppersperklifestyle.com/`;
          const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
            process.env.BULK_SMS_API_KEY
          }&senderid=${
            process.env.BULK_SMS_SENDER_ID
          }&number=${phone}&message=${encodeURIComponent(msg)}`;
          await axios.get(apiUrl);
        }
      }
    } catch (e) {
      console.error("Status SMS error:", e?.response?.data || e.message);
    }
  })();

  // Log Order Status Update Activity
  logActivity({
    req,
    action: "UPDATE_ORDER_STATUS",
    entityType: "Order",
    entityId: order.orderId || order._id,
    description: `Updated status of Order ${order.orderId || order._id} from '${previousStatus}' to '${status}' (Customer: ${order.customerName})`,
    oldValues: { status: previousStatus },
    newValues: { status: status },
    metadata: { orderId: order.orderId, previousStatus, newStatus: status, totalAmount: order.totalAmount }
  });

  res.status(200).json({
    success: true,
    data: order,
  });
});

// @desc    Delete order
// @route   DELETE /api/order/:orderId
// @access  Private/Admin
const deleteOrder = asyncHandler(async (req, res, next) => {
  // Find order by custom orderId from the route parameter
  const order = await Order.findOne({ orderId: req.params.orderId });

  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Order not found with id of ${req.params.orderId}`,
    });
  }

  // Optional: Add stock back if a deleted order is not 'cancelled' or 'delivered'
  if (order.status !== "cancelled" && order.status !== "delivered") {
    for (const item of order.products) {
      const product = await Product.findById(item.productId);
      if (product) {
        const variation = product.variation.find(
          (v) => v._id.toString() === item.variationId.toString(),
        );
        if (variation) {
          variation.stock += item.quantity;
          await product.save();
        }
      }
    }
  }

  // Delete the found order using its _id
  await Order.findByIdAndDelete(order._id);

  res.status(200).json({
    success: true,
    message: "Order deleted successfully",
  });
});

// @desc    Get orders created by the logged-in user
// @route   GET /api/order/my-sells
// @access  Private (Manager/Admin)
const getMySells = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    status = "",
    period = "",
    specificDate,
    startDate,
    endDate,
    orderType,
  } = req.query;

  // Build query - orders created by or associated with logged-in user filtered by orderType
  const activeOrderType = orderType === "online" ? "online" : orderType === "all" ? null : "shop";
  const userOrConditions = [
    { createdBy: req.user._id || req.user.id },
    { salesman: req.user._id || req.user.id },
  ];
  if (req.user.name && req.user.name.trim()) {
    userOrConditions.push({ salesmanName: req.user.name.trim() });
  }

  const query = {
    $or: userOrConditions,
  };

  if (activeOrderType) {
    query.orderType = activeOrderType;
  }

  // Add date range filter based on filter mode
  if (specificDate) {
    // Filter by specific date (entire day)
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);

    query.createdAt = {
      $gte: dateObj,
      $lt: nextDate,
    };
  } else if (startDate || endDate) {
    // Filter by date range
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1); // Include entire end date
      query.createdAt.$lt = endDateObj;
    }
  } else if (period) {
    // Filter by predefined period
    const now = new Date();
    let periodStartDate;

    switch (period) {
      case "daily":
        // Today's orders
        periodStartDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        break;
      case "weekly":
        // Last 7 days
        periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        // Current month
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        // Current year
        periodStartDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        periodStartDate = null;
    }

    if (periodStartDate) {
      query.createdAt = { $gte: periodStartDate };
    }
  }

  // Add status filter if provided
  if (status && status !== "all") {
    query.status = status;
  }

  // Add search filter for orderId or customerName
  if (search) {
    query.$and = [
      {
        $or: [
          { orderId: { $regex: search, $options: "i" } },
          { customerName: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ],
      },
    ];
  }

  // Calculate pagination values
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitValue = parseInt(limit);

  // Get total count
  const totalOrders = await Order.countDocuments(query);
  const totalPages = Math.ceil(totalOrders / limitValue);

  // Fetch orders
  const orders = await Order.find(query)
    .populate("customer", "name phone")
    .populate("createdBy", "name email")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitValue)
    .lean();

  // Calculate total sales amount for the filtered results
  const allFilteredOrders = await Order.find(query).lean();
  const totalSales = allFilteredOrders.reduce(
    (sum, order) => sum + (order.totalAmount || 0),
    0,
  );

  // Calculate total subtotal (Product Value before discount)
  const totalSubtotal = allFilteredOrders.reduce((sum, order) => {
    let orderOrigSubtotal = 0;
    if (order.products && Array.isArray(order.products) && order.products.length > 0) {
      orderOrigSubtotal = order.products.reduce((pSum, p) => {
        const origP = Number(p.originalPrice || (p.price + (p.itemDiscount || 0)) || p.price || 0);
        const qty = Number(p.quantity || 1);
        return pSum + (origP * qty);
      }, 0);
    }
    const finalOrderSubtotal = orderOrigSubtotal > 0 ? orderOrigSubtotal : (Number(order.subtotal) || Number(order.totalAmount) || 0);
    return sum + finalOrderSubtotal;
  }, 0);

  // Calculate total discount given (includes both item-level and order-level discounts)
  const totalDiscount = allFilteredOrders.reduce((sum, order) => {
    let itemDiscs = 0;
    if (order.products && Array.isArray(order.products)) {
      itemDiscs = order.products.reduce((pSum, p) => pSum + (Number(p.itemDiscount || 0) * Number(p.quantity || 1)), 0);
    }
    const orderDisc = Number(order.discountAmount || 0);
    return sum + Math.max(orderDisc, itemDiscs);
  }, 0);

  // Calculate total shipping fee
  const totalShippingFee = allFilteredOrders.reduce(
    (sum, order) => sum + (order.shippingFee || 0),
    0,
  );

  // Calculate Filtered Shop Expenses based on the same date filter
  const Expense = require("../models/Expense");
  const allExpenses = await Expense.find({}).lean();
  const filteredExpenses = allExpenses.filter((exp) => {
    const expDate = new Date(exp.date || exp.createdAt);
    if (specificDate) {
      const dateObj = new Date(specificDate);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      return expDate >= dateObj && expDate < nextDate;
    } else if (startDate || endDate) {
      if (startDate && expDate < new Date(startDate)) return false;
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        if (expDate >= endDateObj) return false;
      }
      return true;
    } else if (period) {
      const now = new Date();
      let periodStartDate;
      switch (period) {
        case "daily":
          periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "weekly":
          periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "monthly":
          periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case "yearly":
          periodStartDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          periodStartDate = null;
      }
      if (periodStartDate) {
        return expDate >= periodStartDate;
      }
    }
    return true;
  });

  const totalShopExpense = filteredExpenses.reduce(
    (sum, exp) => sum + (exp.amount || 0),
    0,
  );

  // Calculate Filtered Exchange Additional Payments based on the same date filter
  const Exchange = require("../models/Exchange");
  const allExchanges = await Exchange.find({}).lean();
  const filteredExchanges = allExchanges.filter((exc) => {
    const excDate = new Date(exc.createdAt);
    if (specificDate) {
      const dateObj = new Date(specificDate);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      return excDate >= dateObj && excDate < nextDate;
    } else if (startDate || endDate) {
      if (startDate && excDate < new Date(startDate)) return false;
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        if (excDate >= endDateObj) return false;
      }
      return true;
    } else if (period) {
      const now = new Date();
      let periodStartDate;
      switch (period) {
        case "daily":
          periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "weekly":
          periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "monthly":
          periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case "yearly":
          periodStartDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          periodStartDate = null;
      }
      if (periodStartDate) {
        return excDate >= periodStartDate;
      }
    }
    return true;
  });

  const totalAdditionalExchangePayment = filteredExchanges.reduce(
    (sum, exc) => sum + (exc.additionalPaymentAmount || 0),
    0,
  );

  const exchangePaymentBreakdown = {
    Cash: 0,
    Bkash: 0,
    Card: 0,
    "Bangla QR": 0,
  };

  filteredExchanges.forEach((ex) => {
    const amt = Number(ex.additionalPaymentAmount) || 0;
    if (amt > 0) {
      const method = ex.paymentMethod || "Cash";
      if (method === "Bkash" || method === "bkash" || method === "bKash") {
        exchangePaymentBreakdown.Bkash += amt;
      } else if (method === "Card" || method === "card") {
        exchangePaymentBreakdown.Card += amt;
      } else if (method === "Bangla QR" || method === "bangla_qr" || method === "BanglaQR") {
        exchangePaymentBreakdown["Bangla QR"] += amt;
      } else {
        exchangePaymentBreakdown.Cash += amt;
      }
    }
  });

  // Calculate payment method breakdown and Change (Excess Payment)
  const paymentMethodStats = {};
  const paymentMethodRefunds = {}; // Store refunds (Item Return + Change) per method
  const cardPosStats = {
    "Pubali Bank POS": 0,
    "City Bank POS": 0,
    "UCB POS": 0,
  };
  let totalChangeAmount = 0; // Total Return Amount (Change) from DB

  allFilteredOrders.forEach((order) => {
    // 1. Calculate Gross Payments
    if (order.payments && Array.isArray(order.payments)) {
      order.payments.forEach((payment) => {
        const method = payment.method || "Unknown";
        const amount = Number(payment.amount) || 0;
        paymentMethodStats[method] = (paymentMethodStats[method] || 0) + amount;

        if (method === "Card" && payment.posMachine) {
          if (cardPosStats[payment.posMachine] !== undefined) {
            cardPosStats[payment.posMachine] += amount;
          } else {
            cardPosStats[payment.posMachine] = amount;
          }
        }
      });
    }

    // Capture explicit returnAmount (Change) from DB if available
    if (order.returnAmount) {
      totalChangeAmount += Number(order.returnAmount);
    }

    // 2. Calculate Change (Excess Payment) for Net Cash calculation
    const paid = order.totalPaid || 0;
    const total = order.totalAmount || 0;
    if (paid > total) {
      let change = paid - total;
      // Deduct change from Cash if present, else first method
      const hasCash =
        order.payments && order.payments.some((p) => p.method === "Cash");
      const methodToDeduct = hasCash
        ? "Cash"
        : order.payments?.[0]?.method || "Cash";

      paymentMethodRefunds[methodToDeduct] =
        (paymentMethodRefunds[methodToDeduct] || 0) + change;
    }
  });

  // --- Handle Returns for Stats ---
  const Return = require("../models/Return");
  const allOrderIds = allFilteredOrders.map((o) => o._id);
  const allReturns = await Return.find({
    order: { $in: allOrderIds },
    status: { $in: ["received", "refunded", "approved"] },
  });

  let totalRefundAmount = 0;

  allReturns.forEach((ret) => {
    const refund = ret.refundAmount || 0;
    totalRefundAmount += refund;

    // Track refunds per payment method
    // Note: We are ADDING to paymentMethodRefunds which may already have Change info
    const originalOrder = allFilteredOrders.find(
      (o) => o._id.toString() === ret.order.toString(),
    );

    if (
      originalOrder &&
      originalOrder.payments &&
      originalOrder.payments.length > 0
    ) {
      const method = originalOrder.payments[0].method || "Unknown";
      paymentMethodRefunds[method] =
        (paymentMethodRefunds[method] || 0) + refund;
    }
  });

  // Include Total Return Value (Merchandise Returns + Change) in Payment Stats
  // Updated Request: "return order ar price Payment Method Breakdown ar return cash a add hobe na."
  // Meaning: Only show CHANGES (Excess Payment) in the Breakdown "Return" (or "Change") section.
  const totalChangeOnly = totalChangeAmount;

  if (totalChangeOnly > 0) {
    paymentMethodStats["Change"] = totalChangeOnly;
  }

  // Note: We are no longer deducting refunds from the individual methods (like Cash) in the stats object
  // here, nor should the frontend. This ensures "Cash" shows gross intake, and "Return" shows gross outflow.

  // Adjust totals
  // const netSales = totalSales - totalRefundAmount; // Reverted: Customer wants gross + separate return stats

  // const netSubtotal = totalSubtotal - totalRefundAmount;

  // Calculate unique returned orders count
  const uniqueReturnedOrderIds = new Set(
    allReturns.map((r) => r.order.toString()),
  );
  const totalReturnedOrdersCount = uniqueReturnedOrderIds.size;

  // --- Handle Returns and Exchanges for Paginated List ---
  // Fetch returns & exchanges for the displayed page of orders to accurately reflect status
  const pageOrderIds = orders.map((o) => o._id);
  const [pageReturns, pageExchanges] = await Promise.all([
    Return.find({
      order: { $in: pageOrderIds },
      status: { $in: ["received", "refunded", "approved"] },
    }).lean(),
    Exchange.find({
      order: { $in: pageOrderIds },
    })
      .populate("originalProduct", "name productId images")
      .populate("originalItems.originalProduct", "name productId images")
      .populate("replacementProduct", "name productId images bannerImage")
      .populate("replacementItems.replacementProduct", "name productId images bannerImage")
      .lean(),
  ]);

  // Update order status in the response list
  orders.forEach((order) => {
    const orderReturns = pageReturns.filter(
      (r) => r.order.toString() === order._id.toString(),
    );
    const orderExchanges = pageExchanges.filter(
      (exc) => exc.order.toString() === order._id.toString(),
    );

    let totalReturnedQty = 0;
    let totalExchangedQty = 0;
    let totalOrderQty = 0;

    // Map returns & exchanges to products
    if (order.products && Array.isArray(order.products)) {
      order.products = order.products.map((product) => {
        const prodIdStr = product.productId?._id?.toString() || product.productId?.toString() || "";
        const prodSize = (product.size || "").trim();
        const prodColor = (product.color || "").trim();
        const prodVarId = product.variationId ? String(product.variationId).trim() : "";

        // 1. Returns matching
        const productReturns = orderReturns.filter((r) => {
          const rProdId = r.product?._id?.toString() || r.product?.toString() || "";
          const rSize = (r.productSize || "").trim();
          const rColor = (r.productColor || "").trim();
          return rProdId === prodIdStr && (!rColor || rColor === prodColor) && (!rSize || rSize === prodSize);
        });

        const returnedQty = productReturns.reduce(
          (sum, r) => sum + (Number(r.quantity) || 0),
          0,
        );
        totalReturnedQty += returnedQty;

        // 2. Exchanges matching (supports both originalItems array and legacy single originalProduct)
        const productExchanges = orderExchanges.filter((exc) => {
          if (Array.isArray(exc.originalItems) && exc.originalItems.length > 0) {
            const hasMatch = exc.originalItems.some((oi) => {
              const oiProdId = oi.originalProduct?._id?.toString() || oi.originalProduct?.toString() || "";
              const oiSize = (oi.originalProductSize || "").trim();
              const oiColor = (oi.originalProductColor || "").trim();
              const oiVarId = oi.originalVariationId ? String(oi.originalVariationId).trim() : "";
              const varMatch = prodVarId && oiVarId ? prodVarId === oiVarId : true;
              return (
                oiProdId === prodIdStr &&
                (!oiColor || !prodColor || oiColor === prodColor) &&
                (!oiSize || !prodSize || oiSize === prodSize) &&
                varMatch
              );
            });
            if (hasMatch) return true;
          }

          const eProdId = exc.originalProduct?._id?.toString() || exc.originalProduct?.toString() || "";
          const eSize = (exc.originalProductSize || "").trim();
          const eColor = (exc.originalProductColor || "").trim();
          const eVarId = exc.originalVariationId ? String(exc.originalVariationId).trim() : "";
          const varMatch = prodVarId && eVarId ? prodVarId === eVarId : true;
          return eProdId === prodIdStr && (!eColor || eColor === prodColor) && (!eSize || eSize === prodSize) && varMatch;
        });

        const exchangedQty = Number(product.exchangedQuantity) > 0
          ? Number(product.exchangedQuantity)
          : productExchanges.reduce(
              (sum, exc) => sum + (Number(exc.exchangeQuantity) || 0),
              0,
            );
        totalExchangedQty += exchangedQty;

        const orderedQty = Number(product.quantity) || 0;
        totalOrderQty += orderedQty;

        return {
          ...product,
          returnedQuantity: returnedQty,
          exchangedQuantity: exchangedQty,
          isReturned: returnedQty >= orderedQty && orderedQty > 0,
          isPartiallyReturned: returnedQty > 0 && returnedQty < orderedQty,
          isExchanged: exchangedQty >= orderedQty && orderedQty > 0,
          isPartiallyExchanged: exchangedQty > 0 && exchangedQty < orderedQty,
          exchangeHistory: productExchanges,
        };
      });
    }

    order.returnsCount = orderReturns.length;
    order.exchangesCount = orderExchanges.length;
    order.returns = orderReturns; // Attach full return list for details modal
    order.exchanges = orderExchanges; // Attach full exchange list for details modal

    // Prioritize status display: Returns > Exchanges > Original Order Status
    if (orderReturns.length > 0) {
      if (totalReturnedQty >= totalOrderQty && totalOrderQty > 0) {
        order.status = "Returned";
      } else {
        order.status = "Partially Returned";
      }
    } else if (orderExchanges.length > 0 || totalExchangedQty > 0) {
      if (totalExchangedQty >= totalOrderQty && totalOrderQty > 0) {
        order.status = "Exchanged";
      } else {
        order.status = "Partially Exchanged";
      }
    }
  });

  // Sort paymentMethodStats so Cash is always first, Card second, etc.
  const sortedPaymentMethodStats = {};
  const methodSortPriority = ["Cash", "Card", "Bkash", "Bangla QR"];
  methodSortPriority.forEach((m) => {
    if (paymentMethodStats[m] !== undefined) {
      sortedPaymentMethodStats[m] = paymentMethodStats[m];
    }
  });
  Object.keys(paymentMethodStats).forEach((m) => {
    if (sortedPaymentMethodStats[m] === undefined) {
      sortedPaymentMethodStats[m] = paymentMethodStats[m];
    }
  });

  const calculatedFinalTotal =
    activeOrderType === "shop"
      ? totalSales + totalAdditionalExchangePayment - totalShopExpense - totalRefundAmount
      : totalSales - totalShippingFee - totalRefundAmount;

  const stats = {
    totalOrders,
    totalSales,
    totalSubtotal,
    totalDiscount,
    totalShippingFee,
    totalRefundAmount,
    totalReturnedOrdersCount,
    totalShopExpense,
    totalAdditionalExchangePayment,
    exchangePaymentBreakdown,
    paymentMethodStats: sortedPaymentMethodStats,
    cardPosStats,
    paymentMethodRefunds,
    finalTotal: calculatedFinalTotal,
  };

  res.status(200).json({
    success: true,
    data: orders,
    stats,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalOrders,
      total: totalOrders,
      totalItems: totalOrders,
      limit: limitValue,
      hasNextPage: parseInt(page) < totalPages,
      hasPrevPage: parseInt(page) > 1,
    },
  });
});

// @desc    Return order - restore stock and delete order
// @route   POST /api/order/return
// @access  Private/Manager and Admin only
const returnOrder = asyncHandler(async (req, res, next) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  // Find order by custom orderId
  const order = await Order.findOne({ orderId: orderId.trim() });

  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Order not found with ID: ${orderId}`,
    });
  }

  // Check if order is a shop order
  if (order.orderType !== "shop") {
    return res.status(403).json({
      success: false,
      message: "Only shop orders can be returned from POS.",
    });
  }

  // Restore stock for all products in the order
  for (const item of order.products) {
    const product = await Product.findById(item.productId);
    if (product) {
      // Find the variation
      let variation;
      if (item.variationId) {
        variation = product.variation.find(
          (v) => v._id.toString() === item.variationId.toString(),
        );
      } else {
        // If no variationId, find by size and color
        variation = product.variation.find(
          (v) => v.size === item.size && v.color === item.color,
        );
      }

      if (variation) {
        variation.stock += item.quantity;
        await product.save();
      }
    }
  }

  // Delete the order
  await Order.findByIdAndDelete(order._id);

  res.status(200).json({
    success: true,
    message: `Order ${orderId} returned successfully. Stock has been restored.`,
    data: {
      orderId: order.orderId,
      customerName: order.customerName,
      totalAmount: order.totalAmount,
      products: order.products.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        size: p.size,
        color: p.color,
      })),
    },
  });
});

// @desc    Get all shop sell orders for return by manager
// @route   GET /api/order/my-orders-for-return
// @access  Private/Manager only
const getMyOrdersForReturn = asyncHandler(async (req, res, next) => {
  // Get only shop sell orders (orderType = 'shop')
  // This excludes online orders (orderType = 'online')
  const orders = await Order.find({ orderType: "shop" })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders,
  });
});

// @desc    Check order type by orderId (for return validation)
// @route   GET /api/order/check-type/:orderId
// @access  Private/Manager only
const checkOrderType = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const rawId = String(orderId || "").trim();

  let query = {};
  if (mongoose.Types.ObjectId.isValid(rawId)) {
    query = { $or: [{ _id: rawId }, { orderId: rawId }, { orderId: `ORD-${rawId}` }] };
  } else {
    const upper = rawId.toUpperCase();
    const formattedId = upper.startsWith("ORD-") ? upper : `ORD-${upper}`;
    query = { $or: [{ orderId: formattedId }, { orderId: rawId }, { orderId: upper }] };
  }

  // Find order by orderId
  const order = await Order.findOne(query).lean();

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found with this Order ID",
      orderType: null,
    });
  }

  res.status(200).json({
    success: true,
    orderType: order.orderType,
    orderId: order.orderId,
    canReturn: order.orderType === "shop",
    order: order.orderType === "shop" ? order : null,
  });
});

// @desc    Check courier parcel fraud & delivery status by phone number via BDCourier API
// @route   POST /api/admin/order/courier-check
// @access  Private (Admin / Employee / Manager)
const checkCourierFraud = asyncHandler(async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: "Phone number is required",
    });
  }

  // Sanitize phone number (remove spaces, leading +88 or 88 if needed)
  let cleanPhone = phone.toString().trim().replace(/[\s\-\(\)]/g, "");
  if (cleanPhone.startsWith("+88")) {
    cleanPhone = cleanPhone.slice(3);
  } else if (cleanPhone.startsWith("88") && cleanPhone.length > 11) {
    cleanPhone = cleanPhone.slice(2);
  }

  const apiKey =
    process.env.BDCOURIER_API_KEY ||
    "MHxEnpjOdx2lyPRkYEeLT4N2ul6WyQgRxVdAvIIhhZgNsjgD1mDO9zV3zRTE";

  try {
    const response = await axios.post(
      "https://api.bdcourier.com/courier-check",
      { phone: cleanPhone },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const data = response.data?.data;
    const reports = response.data?.reports || [];
    const riskVerdict = response.data?.risk_verdict || null;
    const summary = data?.summary;

    const totalParcel = summary?.total_parcel || 0;
    const successParcel = summary?.success_parcel || 0;
    const cancelledParcel = summary?.cancelled_parcel || 0;
    const successRatio =
      summary?.success_ratio !== undefined
        ? Number(summary.success_ratio)
        : totalParcel > 0
        ? (successParcel / totalParcel) * 100
        : 0;

    let computedStatus = "safe";
    let statusText = "Safe";

    if (reports.length > 0) {
      computedStatus = "fraud";
      statusText = "Fraud Reported";
    } else if (riskVerdict?.level) {
      computedStatus = riskVerdict.level;
      statusText = `${riskVerdict.label || "Safe"} (${successRatio.toFixed(0)}%)`;
    } else if (totalParcel === 0) {
      computedStatus = "high_risk";
      statusText = "High risk (0.0%)";
    } else if (successRatio < 70) {
      computedStatus = "return_risk";
      statusText = `Return Risk (${successRatio.toFixed(0)}%)`;
    } else {
      computedStatus = "safe";
      statusText = `Safe (${successRatio.toFixed(0)}%)`;
    }

    const courierSummary = {
      status: computedStatus,
      statusText,
      successRatio,
      totalParcel,
      successParcel,
      cancelledParcel,
      hasReports: reports.length > 0,
      riskVerdict,
      data,
      reports,
      updatedAt: new Date(),
    };

    // Cache to all orders matching this phone number asynchronously
    await Order.updateMany(
      {
        $or: [
          { phone: cleanPhone },
          { phone: `0${cleanPhone}` },
          { phone: `+880${cleanPhone}` },
          { phone: `880${cleanPhone}` },
          { phone: phone.toString().trim() },
        ],
      },
      { $set: { courierSummary } }
    );

    return res.status(200).json({
      ...response.data,
      risk_verdict: riskVerdict,
      courierSummary,
    });
  } catch (error) {
    console.error("BDCourier API Error:", error.response?.data || error.message);
    const errorData = error.response?.data || {};
    return res.status(error.response?.status || 500).json({
      status: "error",
      message:
        errorData.message ||
        "Failed to fetch courier status from BDCourier. Please try again.",
      error: errorData,
    });
  }
});

module.exports = {
  createOrder,
  createOrderByAdmin,
  getAllOrders,
  getMyOrders,
  getOrderById,
  getOrdersByCustomerId,
  updateOrderStatus,
  deleteOrder,
  getMySells,
  returnOrder,
  getMyOrdersForReturn,
  checkOrderType,
  checkCourierFraud,
};
