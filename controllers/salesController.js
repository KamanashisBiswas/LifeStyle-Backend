/**
 * ============================================================
 * controllers/salesController.js — POS / Counter Sales Management
 * ============================================================
 * সরাসরি দোকানথেকে নগদ বা বিকাশ/কার্ড হস্তান্তরে দেয়া POS বিক্রয় handle করে।
 * Manager, Admin ও Employee POS terminal থেকে সার্ভিস operation করতে পারে।
 *
 * API Endpoints:
 *  POST /api/sales               → createSale()        — নতুন POS sale তৈরি
 *  GET  /api/sales               → getAllSales()        — Admin: সব sales (filter/pagination)
 *  GET  /api/sales/dashboard     → getDashboard()      — বিক্রয়, লাভ/লোকসান dashboard summary
 *  GET  /api/sales/:id           → getSaleById()       — একটি sale দেখা
 *  PUT  /api/sales/:id/status    → updateSaleStatus()  — status update
 *
 * createSale ঊর process:
 *  1. Cart items validate  (product exist, variation exist, stock আছে কিনা)
 *  2. Discount calculate (শতকরা / নির্দিষ্ট পরিমাণ)
 *  3. Stock কাটানো
 *  4. Reward points calculate করা
 *  5. Sale (অর্ডার) save করা
 *  6. Customer reward points update
 *  7. SMS confirmation (optional, non-blocking)
 *
 * Payment methods:
 *  Multiple payment সাপোর্ট: Cash, bKash, Nagad, Rocket, Card
 * ============================================================
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const Role = require("../models/Role");
const Return = require("../models/Return");
const Customer = require("../models/Customer");
const Exchange = require("../models/Exchange");
const Expense = require("../models/Expense");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const axios = require("axios");
const mongoose = require("mongoose");
const inventoryService = require("../services/inventoryService");
const { generateCustomId } = require("../utils/customIdGenerator");

// @desc    Create a new POS sale by Manager
// @route   POST /api/sales
// @access  Private (Manager, Admin, Employee)
const createSale = asyncHandler(async (req, res, next) => {
  const {
    items, // Cart items: [{ productId, variationId, name, price, quantity, size, color }]
    customerName,
    customerPhone,
    subtotal,
    discountType, // 'flat' or 'percentage'
    discountValue, // Numeric value (e.g., 500 for flat, 10 for 10%)
    discount, // Calculated discount amount
    total, // Final total after discount
    rewardPoints, // Frontend calculated reward points (optional, we'll recalculate)
    payments, // Array of payments: [{ method: 'Bkash', amount: 200 }, ...]
    totalPaid, // Total amount paid
    returnAmount, // Return amount (change) when customer pays more
    salesmanId, // ID of salesman/sales executive selected by manager
    sendSms = true, // Toggle flag whether to send SMS to customer (defaults to true)
    note, // Optional manager/internal note for the order
    managerNote,
  } = req.body;

  // Validate salesmanId — must be provided and must be a valid salesman user
  if (!salesmanId || !mongoose.Types.ObjectId.isValid(salesmanId)) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid Salesman to proceed.",
    });
  }
  const targetSalesmanDoc = await User.findById(salesmanId).select("name email role").lean();
  if (!targetSalesmanDoc) {
    return res.status(400).json({
      success: false,
      message: "Selected Salesman not found. Please select a valid Salesman.",
    });
  }
  if (targetSalesmanDoc.role === "manager" || targetSalesmanDoc.role === "admin") {
    return res.status(400).json({
      success: false,
      message: "A Manager or Admin account cannot be set as Salesman. Please select a Salesman account.",
    });
  }
  const targetSalesmanId = new mongoose.Types.ObjectId(salesmanId);
  const selectedSalesmanName = targetSalesmanDoc.name;

  // 1. Validate required fields
  if (!items || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Cart is empty. Add products to proceed.",
    });
  }

  if (!customerName || !customerPhone) {
    return res.status(400).json({
      success: false,
      message: "Customer name and phone number are required.",
    });
  }

  // Validate payments
  if (!payments || payments.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one payment method is required.",
    });
  }

  // 2. Validate discount values
  if (
    discountType === "percentage" &&
    (discountValue < 0 || discountValue > 100)
  ) {
    return res.status(400).json({
      success: false,
      message: "Discount percentage must be between 0 and 100.",
    });
  }

  if (discountType === "flat" && discountValue < 0) {
    return res.status(400).json({
      success: false,
      message: "Discount amount cannot be negative.",
    });
  }

  // 3. Calculate totals
  let calculatedSubtotal = 0;
  const orderProducts = [];

  // Validate products and calculate subtotal
  for (const item of items) {
    const product = await Product.findById(item.productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product not found: ${item.name || item.productId}`,
      });
    }

    // Find the specific variation
    const variation = product.variation.find(
      (v) => v._id.toString() === item.variationId,
    );

    if (!variation) {
      return res.status(400).json({
        success: false,
        message: `Variation not found for product ${product.name}`,
      });
    }

    // Check stock availability
    if (variation.stock < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Not enough stock for ${product.name} (${
          variation.size || variation.color || "N/A"
        }). Available: ${variation.stock}, Requested: ${item.quantity}`,
      });
    }

    // Get base variation price (discountPrice if available, otherwise basePrice)
    const baseVarPrice = variation.discountPrice != null ? Number(variation.discountPrice) : Number(variation.basePrice);

    if (isNaN(baseVarPrice) || baseVarPrice < 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid base price for product ${product.name}`,
      });
    }

    // Check if custom item price / per-item discount was applied by manager in POS
    let actualPrice = baseVarPrice;
    if (item.itemDiscount !== undefined && !isNaN(Number(item.itemDiscount)) && Number(item.itemDiscount) >= 0) {
      actualPrice = Math.max(0, baseVarPrice - Number(item.itemDiscount));
    } else if (item.price !== undefined && !isNaN(Number(item.price)) && Number(item.price) >= 0) {
      actualPrice = Number(item.price);
    }

    if (isNaN(actualPrice) || actualPrice < 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid price for product ${product.name}`,
      });
    }

    // Calculate item total & original item total
    const origItemTotal = baseVarPrice * item.quantity;
    const itemTotal = actualPrice * item.quantity;

    // Prepare order product data
    const itemVatRate = item.vat !== undefined && item.vat !== null ? Number(item.vat) : (Number(product.vat) || 0);
    const itemVatAmount = Number(((actualPrice * item.quantity * itemVatRate) / 100).toFixed(2));

    orderProducts.push({
      productId: product._id,
      productIdCode: product.productId || "",
      variationId: variation._id,
      name: product.name,
      price: actualPrice,
      originalPrice: baseVarPrice,
      itemDiscount: baseVarPrice - actualPrice,
      itemDiscountType: item.itemDiscountType || "flat",
      itemDiscountValue: item.itemDiscountValue !== undefined ? Number(item.itemDiscountValue) : (baseVarPrice - actualPrice),
      purchasePrice: variation.purchasePrice || 0,
      quantity: item.quantity,
      size: variation.size || undefined,
      color: variation.color || undefined,
      vat: itemVatRate,
      vatAmount: itemVatAmount,
    });
  }

  // 4. Calculate Subtotal and VAT
  const calculatedOriginalSubtotal = orderProducts.reduce(
    (sum, p) => sum + (Number(p.originalPrice || p.price) * Number(p.quantity)),
    0
  );

  const calculatedAfterItemDiscountSubtotal = orderProducts.reduce(
    (sum, p) => sum + (Number(p.price) * Number(p.quantity)),
    0
  );

  const totalOrderVatAmount = orderProducts.reduce(
    (sum, p) => sum + (Number(p.vatAmount) || 0),
    0
  );

  const totalItemDiscountAmount = calculatedOriginalSubtotal - calculatedAfterItemDiscountSubtotal;

  // Subtotal with VAT included as requested by user ("product price ar sathe vat add hoye sub total a dakhabe")
  const subtotalWithVat = calculatedAfterItemDiscountSubtotal + totalOrderVatAmount;

  // Check if VAT discount is applied (switch ON from Shop POS)
  const isVatDiscountApplied = Boolean(req.body.isVatDiscount || req.body.waiveVat);
  const vatDiscountAmount = isVatDiscountApplied ? totalOrderVatAmount : 0;
  const effectiveSubtotalForDiscount = isVatDiscountApplied ? calculatedAfterItemDiscountSubtotal : subtotalWithVat;

  // 5. Calculate Order-level Discount amount
  let orderDiscountAmount = 0;
  if (discountType === "percentage") {
    orderDiscountAmount = (effectiveSubtotalForDiscount * discountValue) / 100;
  } else if (discountType === "flat") {
    orderDiscountAmount = Math.min(discountValue, effectiveSubtotalForDiscount);
  }

  // Total combined discount (Item-level discounts + Order-level discount + VAT discount)
  const totalCombinedDiscount = totalItemDiscountAmount + orderDiscountAmount + vatDiscountAmount;

  // 6. Calculate final total
  const finalTotal = Math.max(0, (calculatedOriginalSubtotal + totalOrderVatAmount) - totalCombinedDiscount);

  // 6. Calculate reward points for salesman and customer (1 point per 100 currency units)
  const salesmanRewardPoints = Math.floor(finalTotal / 100);
  const customerRewardPoints = Math.floor(finalTotal / 100);

  // 7. No Change concept - return amount is always 0
  const calculatedReturnAmount = 0;

  // 8. Validate calculated values before creating order
  if (isNaN(calculatedOriginalSubtotal) || isNaN(finalTotal) || isNaN(totalCombinedDiscount)) {
    console.error("Invalid calculated values - NaN detected:", {
      calculatedOriginalSubtotal,
      finalTotal,
      totalCombinedDiscount,
      orderProducts,
    });
    return res.status(400).json({
      success: false,
      message: "Invalid calculation. Please check cart items and try again.",
    });
  }

  // 9. Find or create customer by phone match
  const normName = customerName.trim();
  const normPhone = customerPhone.trim();

  let cust = await Customer.findOne({
    phone: normPhone,
  });

  if (!cust) {
    cust = await Customer.create({
      name: normName,
      phone: normPhone,
      registeredFrom: "pos",
    });
  } else if ((!cust.name || cust.name === "Walk-in Customer") && normName) {
    cust.name = normName;
    await cust.save();
  }

  // Determine coupon/discount label
  let discountLabel = "";
  if (orderDiscountAmount > 0) {
    discountLabel =
      discountType === "percentage"
        ? `${discountValue}% OFF`
        : `৳${discountValue} OFF`;
  } else if (totalItemDiscountAmount > 0) {
    const firstItemDisc = orderProducts.find((p) => p.itemDiscount > 0);
    if (firstItemDisc && firstItemDisc.itemDiscountType === "percentage") {
      discountLabel = `${firstItemDisc.itemDiscountValue}% OFF`;
    } else {
      discountLabel = `৳${totalItemDiscountAmount.toFixed(2)} OFF`;
    }
  }

  // Pre-generate custom orderId
  const customOrderId = await generateCustomId("ORD", Order, "orderId", "Order");

  // 10. Atomic Inventory Deduction & Order Creation via Mongoose Session
  const session = await mongoose.startSession();
  session.startTransaction();
  let sale;

  try {
    const { processedItems } = await inventoryService.deductForShopSale({
      orderId: customOrderId,
      items: orderProducts.map((p) => ({
        productId: p.productId,
        variationId: p.variationId,
        size: p.size,
        color: p.color,
        quantity: p.quantity,
      })),
      user: req.user,
      session,
    });

    // Enrich order products with exact location deductions
    for (let i = 0; i < orderProducts.length; i++) {
      if (processedItems[i]) {
        orderProducts[i].deductions = processedItems[i].deductions;
      }
    }

    const [createdSale] = await Order.create(
      [
        {
          orderId: customOrderId,
          customer: cust._id,
          customerName,
          address: "POS Sale", // Default address for POS sales
          phone: customerPhone,
          products: orderProducts,
          subtotal: Number(calculatedOriginalSubtotal).toFixed(2),
          vatAmount: Number(totalOrderVatAmount).toFixed(2),
          shippingFee: 0, // No shipping for POS sales
          shippingArea: "Inside Dhaka", // Default for POS
          totalAmount: Number(finalTotal).toFixed(2),
          discountAmount: Number(totalCombinedDiscount).toFixed(2),
          isVatDiscount: isVatDiscountApplied,
          vatDiscountAmount: Number(vatDiscountAmount).toFixed(2),
          couponCode: discountLabel,
          pointsEarned: customerRewardPoints, // Customer reward points (1 point per ৳100 spent)
          createdBy: req.user.id, // Manager/Admin user who recorded the sale
          salesman: targetSalesmanId, // Selected salesman who earns reward points
          salesmanName: selectedSalesmanName, // Save exact name of selected salesman
          orderType: "shop", // POS/Shop sale order
          status: "delivered", // POS sales are immediately delivered
          payments: Array.isArray(payments)
            ? payments.map((p) => ({
                method: p.method,
                amount: Number(p.amount) || 0,
                posMachine:
                  p.method === "Card" ? p.posMachine || "Pubali Bank POS" : "",
              }))
            : [], // Store payment methods with posMachine
          totalPaid: Number(finalTotal), // Store exact final total as totalPaid
          returnAmount: 0, // No Change concept
          note: (note || managerNote || "").trim(), // Save optional Manager Note
        },
      ],
      { session },
    );

    sale = createdSale;
    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(err.code === "INSUFFICIENT_STOCK" ? 400 : 500).json({
      success: false,
      message: err.message,
      errorCode: err.code || "STOCK_DEDUCTION_FAILED",
      details: err.details || null,
    });
  }

  // Log Employee/Salesman Activity
  logActivity({
    req,
    action: "POS_SALE",
    entityType: "Sale",
    entityId: sale.orderId || sale._id,
    description: `Completed Counter POS Sale for ৳${sale.totalAmount} (Customer: ${sale.customerName}, Phone: ${sale.phone})`,
    metadata: { orderId: sale.orderId, totalAmount: sale.totalAmount, customerName: sale.customerName, itemCount: orderProducts.length }
  });

  // 11. Update target salesman reward points
  try {
    const targetSalesmanUser = await User.findById(targetSalesmanId);

    if (!targetSalesmanUser) {
      console.error("Target Salesman user not found:", targetSalesmanId);
    } else {
      targetSalesmanUser.rewardPoints =
        (targetSalesmanUser.rewardPoints || 0) + salesmanRewardPoints;
      await targetSalesmanUser.save();
    }
  } catch (error) {
    console.error("Error updating salesman reward points:", error);
    // Don't fail the sale if reward points update fails
  }

  // 11.5 Update customer reward points (1 point per ৳100 spent)
  try {
    if (customerRewardPoints > 0 && cust) {
      await Customer.findByIdAndUpdate(cust._id, {
        $inc: { rewardPoints: customerRewardPoints },
      });
    }
  } catch (error) {
    console.error("Error updating customer reward points:", error);
    // Don't fail the sale if customer points update fails
  }

  // 12. Send confirmation SMS (non-blocking, only if sendSms is true)
  if (sendSms !== false && sendSms !== "false") {
    (async () => {
      try {
        const msg = `Dear ${customerName}, your purchase of ৳${finalTotal} has been completed. Order ID: ${sale.orderId}. Thank you for shopping with Shopper'sPerk Lifestyle! Visit: https://shoppersperklifestyle.com/`;
        const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
          process.env.BULK_SMS_API_KEY
        }&senderid=${
          process.env.BULK_SMS_SENDER_ID
        }&number=${customerPhone}&message=${encodeURIComponent(msg)}`;

        const resp = await axios.get(apiUrl);
        if (resp?.data?.response_code !== 202) {
          console.error("Sale SMS failed:", resp?.data);
        }
      } catch (e) {
        console.error("Sale SMS error:", e?.response?.data || e.message);
      }
    })();
  } else {
    console.log("ℹ️ SMS notification skipped for this sale as requested.");
  }

  // 13. Return success response
  res.status(201).json({
    success: true,
    message: `Sale completed successfully! Customer earned ${customerRewardPoints} points, and Salesman earned ${salesmanRewardPoints} points.`,
    data: {
      sale,
      subtotal: calculatedOriginalSubtotal,
      discountAmount: totalCombinedDiscount,
      finalTotal,
      salesmanRewardPoints,
      customerRewardPoints,
      orderId: sale.orderId,
      returnAmount: calculatedReturnAmount, // Include return amount in response
    },
  });
});

// @desc    Get salesman's reward points
// @route   GET /api/sales/rewards
// @access  Private (Salesman, Admin, Employee)
const getSalesmanRewards = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).select(
    "name email role rewardPoints",
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    data: {
      name: user.name,
      email: user.email,
      role: user.role,
      rewardPoints: user.rewardPoints || 0,
    },
  });
});

// @desc    Get all sales made by a salesman
// @route   GET /api/sales/my-sales
// @access  Private (Salesman, Admin, Employee)
const getMySales = asyncHandler(async (req, res, next) => {
  const sales = await Order.find({ createdBy: req.user.id })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(100);

  const totalSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const totalOrders = sales.length;

  res.status(200).json({
    success: true,
    data: {
      sales,
      stats: {
        totalOrders,
        totalSales,
        rewardPoints: req.user.rewardPoints || 0,
      },
    },
  });
});

// @desc    Get all shop orders (POS sales)
// @route   GET /api/sales/shop-orders
// @access  Private (Admin, Employee)
const getShopOrders = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    status,
    period,
    salesman,
    specificDate,
    startDate,
    endDate,
    search,
  } = req.query;

  // Build query for orders created via POS (have createdBy field and address is 'POS Sale')
  let query = {
    createdBy: { $exists: true, $ne: null },
    address: "POS Sale", // Only POS sales, not online orders
  };

  // Add search filter
  if (search && search.trim()) {
    query.$or = [
      { orderId: { $regex: search, $options: "i" } },
      { customerName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  if (status) {
    query.status = status;
  }

  // Filter by specific salesman (either assigned salesman or creator)
  if (salesman) {
    query.$or = [
      { salesman: salesman },
      { createdBy: salesman },
    ];
  }

  // Add date filter based on filter mode
  if (specificDate) {
    // Filter by specific date (entire day)
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);

    query.createdAt = {
      $gte: dateObj,
      $lt: nextDate,
    };
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
  }

  const skip = (page - 1) * limit;

  const orders = await Order.find(query)
    .populate("createdBy", "name email role")
    .populate("salesman", "name email role")
    .populate("products.productId", "name productId images")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean(); // Use lean() to allow modification

  // Fallback: Populate any unpopulated salesman string IDs
  const unpopulatedSalesmanIds = orders
    .map((o) => (typeof o.salesman === "string" ? o.salesman : null))
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

  if (unpopulatedSalesmanIds.length > 0) {
    const salesmanDocs = await User.find({ _id: { $in: unpopulatedSalesmanIds } })
      .select("name email role")
      .lean();
    const salesmanMap = new Map();
    salesmanDocs.forEach((u) => salesmanMap.set(u._id.toString(), u));

    orders.forEach((o) => {
      if (typeof o.salesman === "string" && salesmanMap.has(o.salesman)) {
        o.salesman = salesmanMap.get(o.salesman);
      }
    });
  }

  // Guarantee order.salesmanName is always populated
  orders.forEach((o) => {
    if (!o.salesmanName) {
      if (typeof o.salesman === "object" && o.salesman?.name) {
        o.salesmanName = o.salesman.name;
      }
    }
  });

  // Fetch returns & exchanges for the *paginated* orders to enable line-item strikethrough and exchange status
  const paginatedOrderIds = orders.map((o) => o._id);
  const [paginatedReturns, paginatedExchanges] = await Promise.all([
    Return.find({
      order: { $in: paginatedOrderIds },
      status: { $in: ["received", "refunded", "approved"] },
    })
      .populate("product", "name productId images")
      .lean(),
    Exchange.find({
      order: { $in: paginatedOrderIds },
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

  // Inject returned and exchanged status into order products and update order status
  orders.forEach((order) => {
    const orderReturns = paginatedReturns.filter(
      (r) => r.order.toString() === order._id.toString(),
    );
    const orderExchanges = paginatedExchanges.filter(
      (exc) => exc.order.toString() === order._id.toString(),
    );

    // Ensure every return has a proper productName and productIdCode
    orderReturns.forEach((r) => {
      if (!r.productName || r.productName === "Returned Product") {
        const matchedProd = order.products?.find((p) => {
          const prodIdStr =
            p.productId?._id?.toString() || p.productId?.toString() || "";
          const rProdId =
            r.product?._id?.toString() || r.product?.toString() || "";
          return (
            (prodIdStr && rProdId && prodIdStr === rProdId) ||
            (p.productIdCode && r.productIdCode && p.productIdCode === r.productIdCode)
          );
        });
        if (matchedProd) {
          r.productName = matchedProd.name;
          if (!r.productIdCode && matchedProd.productIdCode) {
            r.productIdCode = matchedProd.productIdCode;
          }
        } else if (r.product?.name) {
          r.productName = r.product.name;
        }
      }
    });

    let totalReturnedQty = 0;
    let totalExchangedQty = 0;
    let totalOrderQty = 0;

    // Map returns & exchanges to products
    if (order.products && Array.isArray(order.products)) {
      order.products = order.products.map((product) => {
        const prodIdStr =
          product.productId?._id?.toString() ||
          product.productId?.toString() ||
          "";
        const prodSize = (product.size || "").trim();
        const prodColor = (product.color || "").trim();
        const prodVarId = product.variationId
          ? String(product.variationId).trim()
          : "";

        // 1. Returns matching
        const productReturns = orderReturns.filter((r) => {
          const rProdId =
            r.product?._id?.toString() || r.product?.toString() || "";
          const rSize = (r.productSize || "").trim();
          const rColor = (r.productColor || "").trim();
          const idMatch = rProdId && prodIdStr && rProdId === prodIdStr;
          const codeMatch = r.productIdCode && product.productIdCode && r.productIdCode === product.productIdCode;
          const nameMatch = r.productName && product.name && r.productName.trim().toLowerCase() === product.name.trim().toLowerCase();
          return (
            (idMatch || codeMatch || nameMatch) &&
            (!rColor || !prodColor || rColor === prodColor) &&
            (!rSize || !prodSize || rSize === prodSize)
          );
        });

        const returnedQty = productReturns.reduce(
          (sum, r) => sum + (Number(r.quantity) || 0),
          0,
        );
        totalReturnedQty += returnedQty;

        // 2. Exchanges matching
        let productExchangedQty = 0;
        const productExchanges = orderExchanges.filter((exc) => {
          if (Array.isArray(exc.originalItems) && exc.originalItems.length > 0) {
            const matchedOis = exc.originalItems.filter((oi) => {
              const oiProdId =
                oi.originalProduct?._id?.toString() ||
                oi.originalProduct?.toString() ||
                "";
              const oiSize = (oi.originalProductSize || "").trim();
              const oiColor = (oi.originalProductColor || "").trim();
              const idMatch = oiProdId && prodIdStr && oiProdId === prodIdStr;
              const codeMatch = oi.originalProductIdCode && product.productIdCode && oi.originalProductIdCode === product.productIdCode;
              const nameMatch = oi.originalProductName && product.name && oi.originalProductName.trim().toLowerCase() === product.name.trim().toLowerCase();
              return (
                (idMatch || codeMatch || nameMatch) &&
                (!oiColor || !prodColor || oiColor === prodColor) &&
                (!oiSize || !prodSize || oiSize === prodSize)
              );
            });

            if (matchedOis.length > 0) {
              const oiQty = matchedOis.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
              productExchangedQty += oiQty;
              return true;
            }
            return false;
          }

          const eProdId =
            exc.originalProduct?._id?.toString() ||
            exc.originalProduct?.toString() ||
            "";
          const eSize = (exc.originalProductSize || "").trim();
          const eColor = (exc.originalProductColor || "").trim();
          const idMatch = eProdId && prodIdStr && eProdId === prodIdStr;
          const codeMatch = exc.originalProductIdCode && product.productIdCode && exc.originalProductIdCode === product.productIdCode;
          const nameMatch = exc.originalProductName && product.name && exc.originalProductName.trim().toLowerCase() === product.name.trim().toLowerCase();
          const isMatch = (idMatch || codeMatch || nameMatch) &&
            (!eColor || !prodColor || eColor === prodColor) &&
            (!eSize || !prodSize || eSize === prodSize);

          if (isMatch) {
            productExchangedQty += (Number(exc.exchangeQuantity) || 1);
            return true;
          }
          return false;
        });

        const exchangedQty =
          Number(product.exchangedQuantity) > 0
            ? Number(product.exchangedQuantity)
            : productExchangedQty;
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

  const totalOrders = await Order.countDocuments(query);

  // Get all orders for stats calculation
  const allOrders = await Order.find(query).lean();

  const totalSales = allOrders.reduce(
    (sum, order) => sum + (order.totalAmount || 0),
    0,
  );

  const totalSubtotal = allOrders.reduce(
    (sum, order) => sum + (order.subtotal || 0),
    0,
  );

  const totalDiscount = allOrders.reduce(
    (sum, order) => sum + (order.discountAmount || 0),
    0,
  );

  // Calculate VAT stats on filtered orders
  let totalGrossVat = 0;
  let totalVatWaived = 0;
  let totalVatReceived = 0;

  allOrders.forEach((order) => {
    if (order.status === "cancelled") return;

    let grossVat = Number(order.vatAmount || 0);
    if (grossVat === 0 && Array.isArray(order.products)) {
      grossVat = order.products.reduce((sum, p) => {
        return (
          sum +
          (Number(p.vatAmount) ||
            (p.vat
              ? (Number(p.price || 0) *
                  Number(p.quantity || 1) *
                  Number(p.vat)) /
                100
              : 0))
        );
      }, 0);
    }

    const isWaived = Boolean(
      order.isVatDiscount || Number(order.vatDiscountAmount || 0) > 0
    );
    const waivedAmount = isWaived
      ? Number(order.vatDiscountAmount || grossVat)
      : 0;
    const netVat = Math.max(0, grossVat - waivedAmount);

    totalGrossVat += grossVat;
    totalVatWaived += waivedAmount;
    totalVatReceived += netVat;
  });

  // Calculate total purchase price and profit with Product model fallback for older records
  const productIdsToFetch = [];
  allOrders.forEach((o) => {
    (o.products || []).forEach((p) => {
      if (p.productId) productIdsToFetch.push(p.productId);
    });
  });
  const dbProductsList = await Product.find({ _id: { $in: productIdsToFetch } }).lean();
  const dbProductMap = new Map(dbProductsList.map((prod) => [prod._id.toString(), prod]));

  let totalPurchasePrice = 0;
  allOrders.forEach((order) => {
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
        const quantity = Number(product.quantity) || 0;
        totalPurchasePrice += purchasePrice * quantity;
      });
    }
  });

  // Total profit = Total sales - Total purchase price
  const totalProfit = totalSales - totalPurchasePrice;

  // Calculate payment method breakdown and Change amount
  const paymentMethodStats = {};
  const cardPosStats = {
    "Pubali Bank POS": 0,
    "City Bank POS": 0,
    "UCB POS": 0,
  };
  let totalChangeAmount = 0;

  allOrders.forEach((order) => {
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
    // And treat it as a "refund" (deduction from Cash/collected money)
    if (order.returnAmount) {
      totalChangeAmount += Number(order.returnAmount);
      // Removed deduction logic to show Gross Intake
    }
  });

  // Include CHANGE in paymentMethodStats as requested (Positive value for display)
  // if (totalChangeAmount > 0) {
  //   paymentMethodStats["Change"] = totalChangeAmount;
  // }

  // Calculate Return Stats (Merchandise Returns)
  const allOrderIds = allOrders.map((o) => o._id);
  const allReturns = await Return.find({
    order: { $in: allOrderIds },
    status: { $in: ["received", "refunded", "approved"] },
  });

  const totalReturnedOrders = allReturns.length;
  let totalReturnValue = 0;

  // Deduction accumulators
  let totalReturnPurchasePrice = 0;
  let totalReturnSubtotal = 0;
  let totalReturnDiscount = 0;

  allReturns.forEach((ret) => {
    const refund = ret.refundAmount || 0;
    totalReturnValue += refund;

    // Do NOT deduct refund amount from Cash in paymentMethodStats to preserve gross cash intake


    const originalOrder = allOrders.find(
      (o) => o._id.toString() === ret.order.toString(),
    );
    if (originalOrder) {
      const matchedProduct = (originalOrder.products || []).find(
        (p) =>
          p.productId.toString() === ret.product.toString() &&
          (p.size === ret.productSize || (!p.size && !ret.productSize)) &&
          (p.color === ret.productColor || (!p.color && !ret.productColor)),
      );
      if (matchedProduct) {
        const retSubtotal = (matchedProduct.price || 0) * (ret.quantity || 0);
        totalReturnSubtotal += retSubtotal;
        totalReturnPurchasePrice +=
          (matchedProduct.purchasePrice || 0) * (ret.quantity || 0);

        // Proportional discount deduction
        const orderSubtotal = originalOrder.subtotal || 0;
        const orderDiscount = originalOrder.discountAmount || 0;
        if (orderSubtotal > 0) {
          totalReturnDiscount += (retSubtotal / orderSubtotal) * orderDiscount;
        }
      }
    }
  });

  // Deduct return values from all totals
  const adjustedTotalSales = totalSales - totalReturnValue;
  const adjustedTotalSubtotal = totalSubtotal - totalReturnSubtotal;
  const adjustedTotalDiscount = totalDiscount - totalReturnDiscount;
  const adjustedTotalPurchasePrice =
    totalPurchasePrice - totalReturnPurchasePrice;
  const adjustedTotalProfit = adjustedTotalSales - adjustedTotalPurchasePrice;

  const totalChangeOnly = totalChangeAmount;

  if (totalChangeOnly > 0) {
    paymentMethodStats["Change"] = totalChangeOnly;
  }

  // Calculate Filtered Shop Expenses based on the same date filter
  const allExpenses = await Expense.find({}).lean();
  const filteredExpenses = allExpenses.filter((exp) => {
    const expDate = new Date(exp.date || exp.createdAt);
    if (specificDate) {
      const dateObj = new Date(specificDate);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      return expDate >= dateObj && expDate < nextDate;
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
      return periodStartDate ? expDate >= periodStartDate : true;
    } else if (startDate || endDate) {
      let valid = true;
      if (startDate) valid = valid && expDate >= new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        valid = valid && expDate < endDateObj;
      }
      return valid;
    }
    return true;
  });

  const totalShopExpense = filteredExpenses.reduce(
    (sum, exp) => sum + (Number(exp.amount) || 0),
    0,
  );

  // Calculate Filtered Exchange Additional Payments based on the same date filter
  const allExchanges = await Exchange.find({}).lean();
  const filteredExchanges = allExchanges.filter((ex) => {
    const exDate = new Date(ex.createdAt);
    if (specificDate) {
      const dateObj = new Date(specificDate);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      return exDate >= dateObj && exDate < nextDate;
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
      return periodStartDate ? exDate >= periodStartDate : true;
    } else if (startDate || endDate) {
      let valid = true;
      if (startDate) valid = valid && exDate >= new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setDate(endDateObj.getDate() + 1);
        valid = valid && exDate < endDateObj;
      }
      return valid;
    }
    return true;
  });

  const totalAdditionalExchangePayment = filteredExchanges.reduce(
    (sum, ex) => sum + (Number(ex.additionalPaymentAmount) || 0),
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

  // Calculate Salesman Breakdown (for Salesman performance cards)
  const salesmenDocs = await User.find({ role: "salesman" })
    .select("name email role rewardPoints")
    .lean();

  const salesmanStatsMap = new Map();

  salesmenDocs.forEach((sm) => {
    salesmanStatsMap.set(sm._id.toString(), {
      id: sm._id.toString(),
      name: sm.name,
      totalOrders: 0,
      totalSales: 0,
      totalPoints: sm.rewardPoints || 0,
    });
  });

  allOrders.forEach((o) => {
    let smId = null;
    if (o.salesman) {
      smId = typeof o.salesman === "object" ? o.salesman._id?.toString() : o.salesman.toString();
    } else if (o.createdBy) {
      smId = typeof o.createdBy === "object" ? o.createdBy._id?.toString() : o.createdBy.toString();
    }

    const smName = o.salesmanName || (typeof o.salesman === "object" ? o.salesman?.name : "") || "";

    if (smId && salesmanStatsMap.has(smId)) {
      const existing = salesmanStatsMap.get(smId);
      existing.totalOrders += 1;
      existing.totalSales += Number(o.totalAmount || 0);
    } else if (smName) {
      let foundKey = null;
      for (const [key, val] of salesmanStatsMap.entries()) {
        if (val.name.toLowerCase() === smName.toLowerCase()) {
          foundKey = key;
          break;
        }
      }
      if (foundKey) {
        const existing = salesmanStatsMap.get(foundKey);
        existing.totalOrders += 1;
        existing.totalSales += Number(o.totalAmount || 0);
      } else {
        const newKey = `name-${smName}`;
        salesmanStatsMap.set(newKey, {
          id: newKey,
          name: smName,
          totalOrders: 1,
          totalSales: Number(o.totalAmount || 0),
          totalPoints: Math.floor(Number(o.totalAmount || 0) / 100),
        });
      }
    }
  });

  const salesmanStats = Array.from(salesmanStatsMap.values());

  const isAdminUser = req.user?.role === "admin";
  const grossProfit = adjustedTotalProfit;
  const netProfit = (totalSales - totalReturnValue + totalAdditionalExchangePayment) - adjustedTotalPurchasePrice - totalShopExpense;

  // Calculate Exchange VAT from filteredExchanges
  let exchangeNetVat = 0;
  let exchangeVatWaived = 0;

  filteredExchanges.forEach((ex) => {
    const netVat = Number(ex.netVatAmount || 0);
    const waived = Number(ex.vatWaivedAmount || 0);
    if (netVat > 0) exchangeNetVat += netVat;
    if (waived > 0) exchangeVatWaived += waived;
  });

  const responseStats = {
    grossTotalSales: totalSales,
    totalSales: totalSales,
    netTotalSales: adjustedTotalSales,
    totalOrders,
    totalSubtotal: totalSubtotal,
    totalDiscount: totalDiscount,
    totalGrossVat: Math.round((totalGrossVat + exchangeNetVat + exchangeVatWaived) * 100) / 100,
    totalVatWaived: Math.round((totalVatWaived + exchangeVatWaived) * 100) / 100,
    totalVatReceived: Math.round((totalVatReceived + exchangeNetVat) * 100) / 100,
    orderVatReceived: Math.round(totalVatReceived * 100) / 100,
    exchangeVatReceived: Math.round(exchangeNetVat * 100) / 100,
    paymentMethodStats,
    cardPosStats,
    totalReturnValue,
    totalReturnedOrders,
    totalShopExpense,
    totalAdditionalExchangePayment,
    exchangePaymentBreakdown,
    salesmanStats,
  };

  if (isAdminUser) {
    responseStats.totalPurchasePrice = adjustedTotalPurchasePrice;
    responseStats.grossProfit = grossProfit;
    responseStats.netProfit = netProfit;
  }

  res.status(200).json({
    success: true,
    data: {
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit: parseInt(limit),
      },
      stats: responseStats,
    },
  });
});

// @desc    Update shop order payment method and payment details
// @route   PUT /api/admin/sales/shop-orders/:id/payment
// @access  Private (Admin only)
const updateShopOrderPayment = asyncHandler(async (req, res, next) => {
  const { payments } = req.body;
  const { id } = req.params;

  // 1. Find order
  const order = await Order.findById(id);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Order not found with id of ${id}`,
    });
  }

  // 3. Validate payments array
  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one payment method with valid amount is required.",
    });
  }

  const validMethods = ["Bkash", "Card", "Cash", "Bangla QR"];
  for (const p of payments) {
    if (!validMethods.includes(p.method)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method: ${p.method}. Allowed: ${validMethods.join(", ")}`,
      });
    }
    if (typeof p.amount !== "number" || p.amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount must be a non-negative number.",
      });
    }
  }

  // 4. Calculate total paid and return amount
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const returnAmount = Math.max(0, totalPaid - order.totalAmount);

  // 5. Update order payment fields
  order.payments = payments.map((p) => ({
    method: p.method,
    amount: Number(p.amount),
    posMachine: p.method === "Card" ? (p.posMachine || "Pubali Bank POS") : "",
  }));
  order.totalPaid = totalPaid;
  order.returnAmount = returnAmount;

  await order.save();

  res.status(200).json({
    success: true,
    message: "Shop order payment details updated successfully",
    data: {
      order,
    },
  });
});

// @desc    Get active salesmen list for POS counter
// @route   GET /api/sales/salesmen
// @access  Private (Manager, Admin, Employee, Salesman, or pos.sell)
const getActiveSalesmen = asyncHandler(async (req, res) => {
  // Check if salesman role has pos.sell by default in Role collection
  const salesmanRole = await Role.findOne({ slug: "salesman" }).lean();
  const roleHasPosSell = salesmanRole?.permissions?.includes("pos.sell");

  let query = { role: "salesman" };
  if (!roleHasPosSell) {
    // Only salesmen who actually have pos.sell permission assigned
    query.permissions = "pos.sell";
  }

  const salesmen = await User.find(query)
    .select("_id name email phone")
    .sort({ name: 1 })
    .lean();

  res.status(200).json({
    success: true,
    data: salesmen,
  });
});

// @desc    Resend confirmation SMS to customer for a sale order
// @route   POST /api/sales/resend-sms/:orderId
// @access  Private (Admin, Manager, Employee, Salesman)
const resendSaleSMS = asyncHandler(async (req, res, next) => {
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

  const order = await Order.findOne(query);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found with this ID",
    });
  }

  // Check customer phone number
  const rawPhone = String(order.phone || "").trim();
  let cleanPhone = rawPhone.replace(/[\s\-\(\)]/g, "");
  if (cleanPhone.startsWith("+88")) {
    cleanPhone = cleanPhone.slice(3);
  } else if (cleanPhone.startsWith("88") && cleanPhone.length > 11) {
    cleanPhone = cleanPhone.slice(2);
  }

  const phoneRegex = /^(?:\+?88)?01[3-9]\d{8}$/;
  if (!cleanPhone || !phoneRegex.test(cleanPhone)) {
    return res.status(400).json({
      success: false,
      message: `Customer phone number (${rawPhone || "empty"}) is invalid for sending SMS.`,
    });
  }

  const apiKey = process.env.BULK_SMS_API_KEY;
  const senderId = process.env.BULK_SMS_SENDER_ID;
  if (!apiKey || !senderId) {
    return res.status(500).json({
      success: false,
      message: "SMS gateway credentials (BULK_SMS_API_KEY / BULK_SMS_SENDER_ID) are not configured on the server.",
    });
  }

  const customerName = order.customerName || "Customer";
  const numTotal = Number(order.totalAmount ?? order.totalPaid ?? 0);
  const finalTotal = numTotal % 1 !== 0 ? numTotal.toFixed(2) : numTotal;
  const msg = `Dear ${customerName}, your purchase of ৳${finalTotal} has been completed. Order ID: ${order.orderId}. Thank you for shopping with Shopper'sPerk Lifestyle! Visit: https://shoppersperklifestyle.com/`;

  try {
    const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${apiKey}&senderid=${senderId}&number=${cleanPhone}&message=${encodeURIComponent(msg)}`;
    const response = await axios.get(apiUrl);

    if (response?.data?.response_code === 202 || response?.data?.success) {
      logActivity({
        req,
        action: "RESEND_SALE_SMS",
        entityType: "Sale",
        entityId: order.orderId || order._id,
        description: `Resent sale confirmation SMS (৳${finalTotal}) to customer ${cleanPhone} for Order ${order.orderId}`,
        metadata: { orderId: order.orderId, phone: cleanPhone, totalAmount: finalTotal },
      });

      return res.status(200).json({
        success: true,
        message: `Confirmation SMS (৳${finalTotal}) resent successfully to ${cleanPhone}!`,
        data: {
          orderId: order.orderId,
          phone: cleanPhone,
          totalAmount: finalTotal,
          smsMessage: msg,
        },
      });
    } else {
      const errorDetail = response?.data?.error_message || response?.data?.message || "SMS provider rejected the request";
      return res.status(502).json({
        success: false,
        message: `Failed to send SMS: ${errorDetail}`,
      });
    }
  } catch (err) {
    console.error("Resend SMS error:", err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || err.message || "Failed to contact SMS gateway",
    });
  }
});

module.exports = {
  createSale,
  getSalesmanRewards,
  getMySales,
  getShopOrders,
  updateShopOrderPayment,
  getActiveSalesmen,
  resendSaleSMS,
};
