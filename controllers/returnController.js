/**
 * ============================================================
 * controllers/returnController.js — Product Return Management
 * ============================================================
 * Customer দ্বারা পণ্য ফেরত এবং Admin দ্বারা return process করা handle করে।
 *
 * API Endpoints:
 *  POST   /api/returns             → createReturnRequest()  — Customer return request
 *  GET    /api/returns             → getAllReturns()         — Admin: সব returns
 *  GET    /api/returns/my-returns  → getMyReturns()         — Customer নিজের returns
 *  GET    /api/returns/:id         → getReturnById()        — একটি return
 *  PUT    /api/returns/:id         → updateReturn()         — Admin: status update, refund amount
 *
 * Return create ঊর validation:
 *  1. Order exist কিনা যাচাই
 *  2. Order ঊ Customer ঊর কিনা যাচাই
 *  3. Order status "delivered" কিনা check
 *  4. Product ঊই order ঊ আছে কিনা check
 *  5. ইতিমধ্যে ফেরত দেওয়া পরিমাণ বেশি হলে block
 *
 * Admin approve করলে:
 *  - status: "approved" হয়
 *  - Product stock ফেরত যোগ করা হয়
 *  - Order status update হয় (partial-returned / returned)
 * ============================================================
 */

const Return = require("../models/Return");
const Order = require("../models/Order");
const Product = require("../models/Product");
const mongoose = require("mongoose");
const { validationResult } = require("express-validator");
const { logActivity } = require("../utils/activityLogger");
const inventoryService = require("../services/inventoryService");

// @desc    Create a return request
// @route   POST /api/returns
// @access  Private (Customer)
exports.createReturnRequest = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      orderId,
      productId,
      quantity,
      reason,
      message,
      productSize,
      productColor,
    } = req.body;
    const customerId = req.customer ? req.customer._id : req.user.id; // Handle both cases for robust auth

    // 1. Verify Order Exists and belongs to Customer
    const order = await Order.findOne({ _id: orderId, customer: customerId });
    if (!order) {
      return res
        .status(404)
        .json({ message: "Order not found or unauthorized" });
    }

    // 2. Verify Order is an Online Order (POS / Shop orders cannot be returned via website)
    if (order.orderType === "shop" || order.orderType === "pos" || order.createdBy) {
      return res
        .status(400)
        .json({ message: "Shop/POS orders cannot be returned online. Only online orders are eligible for return." });
    }

    // 3. Verify Order is Delivered
    if (order.status !== "delivered") {
      return res
        .status(400)
        .json({ message: "Only delivered orders can be returned" });
    }

    // 3. Verify Product is in Order
    const cleanProductId = (productId && typeof productId === "object" && productId._id)
      ? String(productId._id)
      : String(productId || "").trim();

    const norm = (v) => (v !== undefined && v !== null ? String(v).trim().toLowerCase() : "");
    const targetSize = norm(productSize);
    const targetColor = norm(productColor);

    const orderItem = order.products.find((item) => {
      const itemProdId = String(item.productId?._id || item.productId || "");
      const itemSubId = String(item._id || "");
      const itemCode = String(item.productIdCode || "");
      const matchesProduct =
        (itemProdId && itemProdId === cleanProductId) ||
        (itemSubId && itemSubId === cleanProductId) ||
        (itemCode && itemCode === cleanProductId);

      if (!matchesProduct) return false;

      const itemSize = norm(item.size);
      const itemColor = norm(item.color);

      if (targetSize && itemSize && targetSize !== itemSize) {
        return false;
      }
      if (targetColor && itemColor && targetColor !== itemColor) {
        return false;
      }

      return true;
    });

    if (!orderItem) {
      return res
        .status(400)
        .json({ message: "Product not found in this order" });
    }

    if (quantity > orderItem.quantity) {
      return res
        .status(400)
        .json({ message: "Return quantity cannot exceed order quantity" });
    }

    // 4. Check if already returned (Optional: simplistic check, ideally check sum of returns)
    const existingReturns = await Return.find({
      order: orderId,
      product: orderItem.productId,
      productSize: orderItem.size,
      productColor: orderItem.color,
    });

    // Sum existing return quantities
    const alreadyReturnedQty = existingReturns.reduce(
      (acc, ret) => acc + ret.quantity,
      0,
    );

    if (alreadyReturnedQty + parseInt(quantity) > orderItem.quantity) {
      return res.status(400).json({
        message:
          "Cannot return more items than purchased. You may have pending returns.",
      });
    }

    // Calculate refund amount:
    // Calculate net product subtotal (selling price after item-level discounts)
    const netProductSubtotal = (order.products || []).reduce(
      (sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 1)),
      0
    );

    const totalItemDiscounts = (order.products || []).reduce((sum, p) => {
      const origP = Number(p.originalPrice || (Number(p.price || 0) + Number(p.itemDiscount || 0)) || p.price || 0);
      const effP = Number(p.price || 0);
      const disc = (p.itemDiscount !== undefined && Number(p.itemDiscount) > 0)
        ? Number(p.itemDiscount)
        : Math.max(0, origP - effP);
      return sum + disc * Number(p.quantity || 1);
    }, 0);

    const vatWaivedAmount = Boolean(order.isVatDiscount || (order.vatDiscountAmount && Number(order.vatDiscountAmount) > 0))
      ? Number(order.vatDiscountAmount || order.vatAmount || 0)
      : 0;

    const totalDiscountRecorded = Number(order.discountAmount || 0);
    const orderLevelDiscount = Math.max(0, totalDiscountRecorded - totalItemDiscounts - vatWaivedAmount);

    let refundUnit = Number(orderItem.price) || 0;
    if (orderLevelDiscount > 0 && netProductSubtotal > 0) {
      const discountRatio = Math.max(0, (netProductSubtotal - orderLevelDiscount) / netProductSubtotal);
      refundUnit = Number((refundUnit * discountRatio).toFixed(2));
    }
    const refundAmount = Number((refundUnit * parseInt(quantity)).toFixed(2));

    const newReturn = new Return({
      customer: customerId,
      order: orderId,
      product: orderItem.productId,
      productName: orderItem.name,
      productSize: orderItem.size,
      productColor: orderItem.color,
      quantity,
      reason,
      message,
      refundAmount,
    });

    await newReturn.save();

    res.status(201).json({
      message: "Return request submitted successfully",
      data: newReturn,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get customer's returns
// @route   GET /api/returns/my-returns
// @access  Private (Customer)
exports.getMyReturns = async (req, res, next) => {
  try {
    const customerId = req.customer ? req.customer._id : req.user.id;
    const returns = await Return.find({ customer: customerId })
      .populate("order", "orderId createdAt totalAmount")
      .populate("product", "name productId images")
      .sort({ updatedAt: -1, createdAt: -1 });

    res.status(200).json(returns);
  } catch (error) {
    next(error);
  }
};

// @desc    Get all return requests (Admin/Employee)
// @route   GET /api/returns
// @access  Private (Admin/Employee)
exports.getAllReturns = async (req, res, next) => {
  try {
    const { status, search, returnType, page = 1, limit = 10, pagination, specificDate, startDate, endDate, period } = req.query;
    
    // Distinguish between Shop Returns and Online Returns
    const query = {};
    if (returnType === "shop") {
      const shopOrders = await Order.find({ orderType: "shop" }).select("_id").lean();
      const shopOrderIds = shopOrders.map((o) => o._id);
      query.$or = [
        { returnType: "shop" },
        { reason: "Shop Return" },
        { order: { $in: shopOrderIds } },
      ];
    } else {
      const shopOrders = await Order.find({ orderType: "shop" }).select("_id").lean();
      const shopOrderIds = shopOrders.map((o) => o._id);
      query.returnType = { $ne: "shop" };
      query.reason = { $ne: "Shop Return" };
      if (shopOrderIds.length > 0) {
        query.order = { $nin: shopOrderIds };
      }
    }

    if (status && status !== "all") query.status = status;

    // Date Filtering (checks updatedAt or createdAt)
    if (specificDate) {
      const dateObj = new Date(specificDate);
      const nextDate = new Date(dateObj);
      nextDate.setDate(nextDate.getDate() + 1);
      const dateFilterCond = { $gte: dateObj, $lt: nextDate };
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { updatedAt: dateFilterCond },
            { createdAt: dateFilterCond }
          ]
        }
      ]);
    } else if (startDate || endDate) {
      const dateRangeCond = {};
      if (startDate) dateRangeCond.$gte = new Date(startDate);
      if (endDate) {
        const eDate = new Date(endDate);
        eDate.setHours(23, 59, 59, 999);
        dateRangeCond.$lte = eDate;
      }
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { updatedAt: dateRangeCond },
            { createdAt: dateRangeCond }
          ]
        }
      ]);
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
        query.$and = (query.$and || []).concat([
          {
            $or: [
              { updatedAt: { $gte: periodStartDate } },
              { createdAt: { $gte: periodStartDate } }
            ]
          }
        ]);
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      
      // Find matching Order IDs and Customer IDs to allow search by Order ID / Customer
      const matchingOrders = await Order.find({
        $or: [
          { orderId: regex },
          { customerName: regex },
          { phone: regex },
        ],
      }).select("_id").lean();

      const matchingOrderIds = matchingOrders.map((o) => o._id);

      const searchConditions = [
        { returnId: regex },
        { productName: regex },
        { order: { $in: matchingOrderIds } },
      ];

      query.$and = (query.$and || []).concat([{ $or: searchConditions }]);
    }

    let returns;
    let total;

    // Calculate summary statistics
    const summaryQuery = { ...query };
    delete summaryQuery.status;

    const [statusAgg, metricsAgg] = await Promise.all([
      Return.aggregate([
        { $match: summaryQuery },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Return.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalRefundAmount: { $sum: "$refundAmount" },
            totalReturnedQty: { $sum: "$quantity" },
          },
        },
      ]),
    ]);

    let pendingCount = 0;
    let approvedCount = 0;
    let receivedCount = 0;
    let refundedCount = 0;
    let rejectedCount = 0;

    statusAgg.forEach((item) => {
      if (item._id === "pending") pendingCount = item.count;
      if (item._id === "approved") approvedCount = item.count;
      if (item._id === "received") receivedCount = item.count;
      if (item._id === "refunded") refundedCount = item.count;
      if (item._id === "rejected") rejectedCount = item.count;
    });

    if (pagination === "false") {
      returns = await Return.find(query)
        .populate("customer", "name email phone")
        .populate({
          path: "order",
          select: "orderId customerName phone products",
          populate: { path: "products.productId", select: "name productId images" },
        })
        .populate("product", "name productId images bannerImage variation")
        .populate("processedBy", "name")
        .sort({ updatedAt: -1, createdAt: -1 });
      total = returns.length;

      const stats = {
        totalReturns: total,
        total: total,
        pendingCount,
        approvedCount,
        receivedCount,
        refundedCount,
        rejectedCount,
        totalRefundAmount: metricsAgg[0]?.totalRefundAmount || 0,
        totalReturnedQty: metricsAgg[0]?.totalReturnedQty || 0,
      };

      return res.status(200).json({
        data: returns,
        totalReturns: total,
        stats,
      });
    }

    const skip = (page - 1) * limit;

    const [returnsList, totalCount] = await Promise.all([
      Return.find(query)
        .populate("customer", "name email phone")
        .populate({
          path: "order",
          select: "orderId customerName phone products",
          populate: { path: "products.productId", select: "name productId images" },
        })
        .populate("product", "name productId images bannerImage variation")
        .populate("processedBy", "name")
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit)),
      Return.countDocuments(query),
    ]);

    returns = returnsList;
    total = totalCount;

    const stats = {
      totalReturns: total,
      total: total,
      pendingCount,
      approvedCount,
      receivedCount,
      refundedCount,
      rejectedCount,
      totalRefundAmount: metricsAgg[0]?.totalRefundAmount || 0,
      totalReturnedQty: metricsAgg[0]?.totalReturnedQty || 0,
    };

    res.status(200).json({
      data: returns,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      totalReturns: total,
      stats,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update return status
// @route   PUT /api/returns/:id/status
// @access  Private (Admin/Employee)
exports.updateReturnStatus = async (req, res, next) => {
  try {
    const { status, adminComment } = req.body;
    const returnValues = await Return.findById(req.params.id);

    if (!returnValues) {
      return res.status(404).json({ message: "Return request not found" });
    }

    const oldStatus = returnValues.status;

    // Transition progression rules (Strict Step-by-Step):
    const ALLOWED_RETURN_TRANSITIONS = {
      pending: ["approved", "rejected"],
      approved: ["received", "rejected"],
      received: ["refunded", "rejected"],
      refunded: [],
      rejected: [],
    };

    if (oldStatus !== status) {
      const allowedNext = ALLOWED_RETURN_TRANSITIONS[oldStatus] || [];
      if (!allowedNext.includes(status)) {
        return res.status(400).json({
          message: `Cannot change status from '${oldStatus}' to '${status}'. ${
            allowedNext.length > 0
              ? `Allowed next status(es): ${allowedNext.join(", ")}.`
              : `Return is in final status '${oldStatus}' and cannot be modified.`
          }`,
        });
      }
    }

    returnValues.status = status;
    returnValues.adminComment = adminComment || returnValues.adminComment;
    returnValues.processedBy = req.user.id;

    // Stock Update Logic:
    // If status changes to 'received' or 'refunded', and it wasn't previously in one of those states,
    // we add the stock back to the product.
    const stockRestoredStatuses = ["received", "refunded"];
    const isNewStatusStockRestored = stockRestoredStatuses.includes(status);
    const wasOldStatusStockRestored = stockRestoredStatuses.includes(oldStatus);

    if (isNewStatusStockRestored && !wasOldStatusStockRestored) {
      const product = await Product.findById(returnValues.product);
      if (product) {
        await inventoryService.restoreForOnlineReturn({
          returnId: returnValues.returnId || returnValues._id,
          orderId: returnValues.order,
          productDoc: product,
          variationId: returnValues.variationId,
          size: returnValues.productSize,
          color: returnValues.productColor,
          quantity: returnValues.quantity,
          user: req.user,
        });
      }
    }

    await returnValues.save();

    // Sync Order Status (Returned / Partial-Returned / Delivered)
    // Only applies when return has reached final state "refunded"
    if (returnValues.order) {
      const order = await Order.findById(returnValues.order);
      if (order && Array.isArray(order.products)) {
        const allFinalReturnsForOrder = await Return.find({
          order: order._id,
          status: { $in: ["refunded"] },
        });

        const totalOrderQty = order.products.reduce((acc, p) => acc + (Number(p.quantity) || 1), 0);
        const totalReturnedQty = allFinalReturnsForOrder.reduce((acc, r) => acc + (Number(r.quantity) || 1), 0);

        if (totalReturnedQty >= totalOrderQty && totalOrderQty > 0) {
          order.status = "returned";
        } else if (totalReturnedQty > 0) {
          order.status = "partial-returned";
        } else if (order.status === "returned" || order.status === "partial-returned") {
          order.status = "delivered";
        }
        await order.save();
      }
    }

    logActivity({
      req,
      action: "PROCESS_RETURN",
      entityType: "Return",
      entityId: returnValues.returnId || returnValues._id,
      description: `Updated return request status to '${status}'`,
      metadata: { returnId: returnValues.returnId, newStatus: status, quantity: returnValues.quantity }
    });

    res.status(200).json({
      message: `Return request updated to ${status}`,
      data: returnValues,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process shop return (Manager/Admin)
// @route   POST /api/returns/shop-return
// @access  Private (Manager/Admin)
exports.processShopReturn = async (req, res, next) => {
  try {
    const { orderId, items, note, notes, managerNote } = req.body;
    // items: [{ productId, variationId, quantity, reason, size, color, note }]

    if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Invalid request data" });
    }

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
      return res.status(404).json({ message: "Order not found" });
    }

    // Check status: Only Delivered or Partially Returned orders can be returned
    // (Prevents returning cancelled or pending orders)
    if (!["delivered", "partial-returned"].includes(order.status)) {
      return res.status(400).json({
        message: `Order status is '${order.status}'. Only delivered orders can be returned.`,
      });
    }

    // Check ownership
    // Ensure req.user exists (authenticate middleware)
    if (
      order.createdBy &&
      order.createdBy.toString() !== req.user.id.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You can only return orders created by you." });
    }

    // Check 7 days limit
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    // Reset time part for accurate date comparison if needed, but timestamp comparison is safer
    if (new Date(order.createdAt) < sevenDaysAgo) {
      return res
        .status(400)
        .json({ message: "Order is older than 7 days, cannot return." });
    }

    const processedReturns = [];

    for (const item of items) {
      const { productId, size, color, quantity, reason, message } = item;

      // 1. Verify Product in Order
      const orderItem = order.products.find(
        (p) =>
          p.productId.toString() === productId &&
          (size ? p.size === size : true) &&
          (color ? p.color === color : true),
      );

      if (!orderItem) {
        continue; // Skip invalid items
      }

      // 2. Check quantities
      const existingReturns = await Return.find({
        order: order._id,
        product: productId,
        productSize: size,
        productColor: color,
      });

      const alreadyReturnedQty = existingReturns.reduce(
        (acc, ret) => acc + ret.quantity,
        0,
      );

      if (alreadyReturnedQty + parseInt(quantity) > orderItem.quantity) {
        // You might want to throw error or skip.
        // For now, let's throw error to stop partial illogical state
        return res.status(400).json({
          message: `Cannot return more than purchased for item ${orderItem.name}. Already returned: ${alreadyReturnedQty}`,
        });
      }

      // Calculate refund amount:
      // Calculate net product subtotal (selling price after item-level discounts)
      const netProductSubtotal = (order.products || []).reduce(
        (sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 1)),
        0
      );

      const totalItemDiscounts = (order.products || []).reduce((sum, p) => {
        const origP = Number(p.originalPrice || (Number(p.price || 0) + Number(p.itemDiscount || 0)) || p.price || 0);
        const effP = Number(p.price || 0);
        const disc = (p.itemDiscount !== undefined && Number(p.itemDiscount) > 0)
          ? Number(p.itemDiscount)
          : Math.max(0, origP - effP);
        return sum + disc * Number(p.quantity || 1);
      }, 0);

      const vatWaivedAmount = Boolean(order.isVatDiscount || (order.vatDiscountAmount && Number(order.vatDiscountAmount) > 0))
        ? Number(order.vatDiscountAmount || order.vatAmount || 0)
        : 0;

      const totalDiscountRecorded = Number(order.discountAmount || 0);
      const orderLevelDiscount = Math.max(0, totalDiscountRecorded - totalItemDiscounts - vatWaivedAmount);

      let refundUnit = Number(orderItem.price) || 0;
      if (orderLevelDiscount > 0 && netProductSubtotal > 0) {
        const discountRatio = Math.max(0, (netProductSubtotal - orderLevelDiscount) / netProductSubtotal);
        refundUnit = Number((refundUnit * discountRatio).toFixed(2));
      }
      const refundAmount = Number((refundUnit * parseInt(quantity)).toFixed(2));

      const returnNote = (item.note || item.message || note || notes || managerNote || "").trim();

      // Normalize reason to valid enum values safely
      const validReasons = [
        "Defective",
        "Wrong Item",
        "Size Doesn't Fit",
        "Wrong Size",
        "Color Mismatch",
        "Changed Mind",
        "Shop Return",
        "Damaged",
        "Customer Request",
        "Not as Described",
        "Other",
      ];
      let itemReason = (reason || item.reason || "Shop Return").trim();
      if (!validReasons.includes(itemReason)) {
        if (itemReason.toLowerCase().includes("size")) itemReason = "Wrong Size";
        else if (itemReason.toLowerCase().includes("defect") || itemReason.toLowerCase().includes("damage")) itemReason = "Defective";
        else itemReason = "Shop Return";
      }

      // 3. Create Return Record
      const newReturn = new Return({
        customer: order.customer || null, // Might be null for shop order
        user: req.user.id, // Track who processed it (manager)
        processedBy: req.user.id, // Auto processed
        order: order._id,
        product: productId,
        productName: orderItem.name,
        productSize: size,
        productColor: color,
        quantity: parseInt(quantity),
        reason: itemReason,
        returnType: "shop",
        message: returnNote || "Processed via Shop Return",
        status: "received", // Automatically received
        adminComment: returnNote || `Shop Return processed by ${req.user.name || "Manager"}`,
        refundAmount: refundAmount,
      });

      await newReturn.save();

      // 4. Restore Stock strictly to Display via centralized inventory service
      await inventoryService.restoreForShopReturn({
        orderId: order._id,
        items: [
          {
            productId,
            variationId: item.variationId,
            size,
            color,
            quantity: parseInt(quantity),
            reason: itemReason,
          },
        ],
        user: req.user,
      });

      processedReturns.push(newReturn);
    }

    // 5. Update Order Status (Returned vs Partial Returned)
    // Recalculate total returns for this order to determine status
    const allReturnsForOrder = await Return.find({
      order: order._id,
      status: { $in: ["received", "refunded", "approved"] },
    });

    const totalOrderQty = order.products.reduce(
      (acc, p) => acc + p.quantity,
      0,
    );
    const totalReturnedQty = allReturnsForOrder.reduce(
      (acc, r) => acc + r.quantity,
      0,
    );

    if (totalReturnedQty >= totalOrderQty) {
      order.status = "returned";
    } else if (totalReturnedQty > 0) {
      order.status = "partial-returned";
    }
    await order.save();

    res.status(200).json({
      success: true,
      message: "Shop return processed successfully",
      data: processedReturns,
    });
  } catch (error) {
    next(error);
  }
};
