/**
 * ============================================================
 * controllers/ownerPayoutController.js — Shop Owner Payout
 * ============================================================
 * Controller for managing Payouts and disbursements to
 * the shop owner from in-store (POS) net profit.
 *
 * RBAC Rules:
 *  - Manager, Employee, Admin → Create & View Payout Entries
 *  - Admin Only → Edit & Delete Payout Entries
 * ============================================================
 */
const asyncHandler = require("../utils/asyncHandler");
const OwnerPayout = require("../models/OwnerPayout");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Expense = require("../models/Expense");
const Exchange = require("../models/Exchange");
const Return = require("../models/Return");
const { logActivity } = require("../utils/activityLogger");

/**
 * Helper: Calculate Real-time Shop (POS) Net Profit
 * Formula: (Shop Gross Sales - Shop Returns + Exchange Difference - Shop Expenses) - Cost of Goods Sold
 */
const calculateShopNetProfit = async () => {
  try {
    const shopOrders = await Order.find({ address: "POS Sale" }).lean();
    let shopSales = 0;
    let shopProductCost = 0;

    const shopProductIds = [];
    shopOrders.forEach((o) => {
      (o.products || []).forEach((p) => {
        if (p.productId) shopProductIds.push(p.productId);
      });
    });
    const dbProductsList = await Product.find({ _id: { $in: shopProductIds } }).lean();
    const dbProductMap = new Map(dbProductsList.map((prod) => [prod._id.toString(), prod]));

    shopOrders.forEach((order) => {
      shopSales += Number(order.totalAmount || 0);
      if (order.products && Array.isArray(order.products)) {
        order.products.forEach((product) => {
          let purchasePrice = Number(product.purchasePrice) || 0;
          if (purchasePrice === 0 && product.productId) {
            const dbProd = dbProductMap.get(product.productId.toString());
            if (dbProd && Array.isArray(dbProd.variation)) {
              const matchedVar = dbProd.variation.find(
                (v) =>
                  (v.size === product.size || (!v.size && !product.size)) &&
                  (v.color === product.color || (!v.color && !product.color))
              );
              if (matchedVar) purchasePrice = Number(matchedVar.purchasePrice) || 0;
              else if (dbProd.variation[0]) purchasePrice = Number(dbProd.variation[0].purchasePrice) || 0;
            }
          }
          shopProductCost += purchasePrice * Number(product.quantity || 0);
        });
      }
    });

    // Shop Returns
    const shopOrderIds = shopOrders.map((o) => o._id);
    const allShopReturns = await Return.find({
      $or: [
        { order: { $in: shopOrderIds } },
        { reason: "Shop Return" },
      ],
      status: { $nin: ["rejected"] },
    }).lean();

    let shopReturnValue = 0;
    let totalShopReturnPurchasePrice = 0;

    allShopReturns.forEach((ret) => {
      const refund = Number(ret.refundAmount || 0);
      shopReturnValue += refund;

      const originalOrder = shopOrders.find(
        (o) => o._id.toString() === (ret.order?._id || ret.order || "").toString()
      );
      if (originalOrder) {
        const matchedProduct = (originalOrder.products || []).find(
          (p) =>
            (p.productId?._id || p.productId || "").toString() === (ret.product?._id || ret.product || "").toString() &&
            (p.size === ret.productSize || (!p.size && !ret.productSize)) &&
            (p.color === ret.productColor || (!p.color && !ret.productColor))
        );
        if (matchedProduct) {
          totalShopReturnPurchasePrice += (Number(matchedProduct.purchasePrice) || 0) * (Number(ret.quantity) || 0);
        }
      }
    });

    // Also include Order model returns if any
    const shopReturnedOrders = await Order.find({
      address: "POS Sale",
      status: { $in: ["returned", "partial-returned", "refunded"] },
    }).lean();
    shopReturnedOrders.forEach((order) => {
      const alreadyCounted = allShopReturns.some(
        (r) => (r.order?._id || r.order || "").toString() === order._id.toString()
      );
      if (!alreadyCounted) {
        shopReturnValue += Number(order.totalAmount || order.subtotal || 0);
      }
    });

    const adjustedShopPurchaseCost = Math.max(0, shopProductCost - totalShopReturnPurchasePrice);

    // Shop Exchanges Cash
    const exchanges = await Exchange.find({}).lean();
    const shopExchangeValue = exchanges.reduce(
      (sum, ex) => sum + Number(ex.additionalPaymentAmount || 0),
      0
    );

    // Shop Expenses
    const expenses = await Expense.find({}).lean();
    const totalShopExpense = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const shopNetProfit = (shopSales - shopReturnValue + shopExchangeValue - totalShopExpense) - adjustedShopPurchaseCost;

    return {
      shopNetProfit,
      shopSales,
      shopReturnValue,
      shopExchangeValue,
      totalShopExpense,
      adjustedShopPurchaseCost,
    };
  } catch (error) {
    console.error("Error calculating real-time shop net profit:", error);
    return {
      shopNetProfit: 0,
      shopSales: 0,
      shopReturnValue: 0,
      shopExchangeValue: 0,
      totalShopExpense: 0,
      adjustedShopPurchaseCost: 0,
    };
  }
};

// @desc    Create a new owner payout entry
// @route   POST /api/owner-payout
// @access  Private (Manager, Employee, Admin)
const createPayout = asyncHandler(async (req, res) => {
  const {
    amount,
    paymentMethod,
    recipientName,
    date,
    bankName,
    accountNumber,
    transactionId,
    note,
    status,
  } = req.body;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({
      success: false,
      message: "A valid payout amount greater than 0 is required",
    });
  }

  const feedbackMsg = (note || req.body.feedback || "").trim();
  const initialThread = [];
  if (feedbackMsg) {
    initialThread.push({
      sender: req.user._id || req.user.id,
      senderName: req.user.name || "Manager",
      senderRole: req.user.role || "manager",
      message: feedbackMsg,
      createdAt: new Date(),
    });
  }

  const payout = await OwnerPayout.create({
    amount: Number(amount),
    paymentMethod: paymentMethod || "Cash",
    recipientName: (recipientName || "Shop Owner").trim(),
    profitType: "shop",
    date: date ? new Date(date) : new Date(),
    handedOverBy: req.user._id || req.user.id,
    handedOverByName: req.user.name || "Manager",
    handedOverByRole: req.user.role || "manager",
    bankName: (bankName || "").trim(),
    accountNumber: (accountNumber || "").trim(),
    transactionId: (transactionId || "").trim(),
    note: feedbackMsg,
    feedback: feedbackMsg,
    feedbackThread: initialThread,
    status: status || (req.user.role === "admin" ? "Approved" : "Pending"),
  });

  // Log activity
  logActivity({
    req,
    action: "CREATE_OWNER_PAYOUT",
    entityType: "OwnerPayout",
    entityId: payout._id,
    description: `Payout of ৳${payout.amount} recorded for ${payout.recipientName} via ${payout.paymentMethod} (Handed by: ${payout.handedOverByName})`,
    metadata: {
      payoutId: payout.payoutId,
      amount: payout.amount,
      paymentMethod: payout.paymentMethod,
      recipientName: payout.recipientName,
    },
  });

  res.status(201).json({
    success: true,
    message: "Owner payout recorded successfully",
    data: payout,
  });
});

// @desc    Get all owner payouts with filters, pagination & shop profit summary
// @route   GET /api/owner-payout
// @access  Private (Manager, Employee, Admin)
const getAllPayouts = asyncHandler(async (req, res) => {
  const {
    search,
    paymentMethod,
    handedOverBy,
    startDate,
    endDate,
    page = 1,
    limit = 20,
  } = req.query;

  const filter = {};

  if (paymentMethod && paymentMethod !== "all") {
    filter.paymentMethod = paymentMethod;
  }

  if (handedOverBy && handedOverBy !== "all") {
    filter.handedOverByName = { $regex: handedOverBy, $options: "i" };
  }

  // Date range filter
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) {
      filter.date.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  // Search filter
  if (search && search.trim() !== "") {
    const s = search.trim();
    filter.$or = [
      { payoutId: { $regex: s, $options: "i" } },
      { recipientName: { $regex: s, $options: "i" } },
      { handedOverByName: { $regex: s, $options: "i" } },
      { note: { $regex: s, $options: "i" } },
      { bankName: { $regex: s, $options: "i" } },
      { transactionId: { $regex: s, $options: "i" } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [payouts, totalCount] = await Promise.all([
    OwnerPayout.find(filter)
      .populate("handedOverBy", "name email role")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    OwnerPayout.countDocuments(filter),
  ]);

  // Only Admin-Approved payouts count towards the metric cards
  const approvedCondition = {
    status: { $nin: ["Cancelled", "Rejected"] },
    $or: [
      { status: { $in: ["Approved", "Completed"] } },
      { "adminReply.message": { $exists: true, $ne: "" } },
      { handedOverByRole: "admin" },
    ],
  };

  const allApprovedPayouts = await OwnerPayout.find(approvedCondition).lean();

  let totalPaidToOwner = 0;
  let todayPaid = 0;
  let monthPaid = 0;
  let yearPaid = 0;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  allApprovedPayouts.forEach((p) => {
    const amt = Number(p.amount || 0);
    totalPaidToOwner += amt;

    const pDate = new Date(p.date || p.createdAt);
    if (pDate >= todayStart) todayPaid += amt;
    if (pDate >= monthStart) monthPaid += amt;
    if (pDate >= yearStart) yearPaid += amt;
  });

  // Calculate filtered payouts total (only approved payouts within active filter)
  const filteredApprovedPayouts = await OwnerPayout.find({
    ...filter,
    ...approvedCondition,
  }).lean();

  const filteredTotalPaid = filteredApprovedPayouts.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );

  // Distinct staff who gave entries
  const allPayouts = await OwnerPayout.find({ status: { $ne: "Cancelled" } }).lean();
  const allStaff = [...new Set(allPayouts.map((p) => p.handedOverByName).filter(Boolean))];

  // Count pending payouts awaiting approval
  const pendingTransactions = await OwnerPayout.countDocuments({
    status: "Pending",
    $and: [
      { $or: [{ "adminReply.message": { $exists: false } }, { "adminReply.message": "" }] },
      { handedOverByRole: { $ne: "admin" } },
    ],
  });

  const stats = {
    totalPaidToOwner,
    filteredTotalPaid,
    todayPaid,
    monthPaid,
    yearPaid,
    totalTransactions: allApprovedPayouts.length,
    pendingTransactions,
    filteredTransactions: totalCount,
    allStaff,
  };

  // Only Admin can see confidential Shop Net Profit & Store Financial Balances
  if (req.user.role === "admin") {
    const { shopNetProfit, shopSales, shopReturnValue, shopExchangeValue, totalShopExpense, adjustedShopPurchaseCost } =
      await calculateShopNetProfit();
    const remainingProfitBalance = shopNetProfit - totalPaidToOwner;

    stats.shopNetProfit = Math.round(shopNetProfit * 100) / 100;
    stats.remainingProfitBalance = Math.round(remainingProfitBalance * 100) / 100;
    stats.shopSales = shopSales;
    stats.shopReturnValue = shopReturnValue;
    stats.shopExchangeValue = shopExchangeValue;
    stats.totalShopExpense = totalShopExpense;
    stats.adjustedShopPurchaseCost = adjustedShopPurchaseCost;
  }

  res.status(200).json({
    success: true,
    data: payouts,
    stats,
    pagination: {
      total: totalCount,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(totalCount / Number(limit)),
    },
  });
});

// @desc    Get single payout by ID
// @route   GET /api/owner-payout/:id
// @access  Private (Manager, Employee, Admin)
const getPayoutById = asyncHandler(async (req, res) => {
  const payout = await OwnerPayout.findById(req.params.id)
    .populate("handedOverBy", "name email role")
    .lean();

  if (!payout) {
    return res.status(404).json({
      success: false,
      message: "Payout record not found",
    });
  }

  res.status(200).json({
    success: true,
    data: payout,
  });
});

// @desc    Update payout entry (ADMIN ONLY)
// @route   PUT /api/owner-payout/:id
// @access  Private (Admin Only)
const updatePayout = asyncHandler(async (req, res) => {
  const {
    amount,
    paymentMethod,
    recipientName,
    date,
    bankName,
    accountNumber,
    transactionId,
    note,
    status,
  } = req.body;

  const payout = await OwnerPayout.findById(req.params.id);

  if (!payout) {
    return res.status(404).json({
      success: false,
      message: "Payout record not found",
    });
  }

  const oldAmount = payout.amount;

  if (amount !== undefined) {
    if (isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid payout amount is required",
      });
    }
    payout.amount = Number(amount);
  }

  if (paymentMethod) payout.paymentMethod = paymentMethod;
  if (recipientName) payout.recipientName = recipientName.trim();
  if (date) payout.date = new Date(date);
  if (bankName !== undefined) payout.bankName = bankName.trim();
  if (accountNumber !== undefined) payout.accountNumber = accountNumber.trim();
  if (transactionId !== undefined) payout.transactionId = transactionId.trim();
  if (note !== undefined) payout.note = note.trim();
  if (status) payout.status = status;

  await payout.save();

  // Log activity
  logActivity({
    req,
    action: "UPDATE_OWNER_PAYOUT",
    entityType: "OwnerPayout",
    entityId: payout._id,
    description: `Admin updated owner payout ${payout.payoutId}: ৳${oldAmount} -> ৳${payout.amount}`,
    metadata: { payoutId: payout.payoutId, oldAmount, newAmount: payout.amount },
  });

  res.status(200).json({
    success: true,
    message: "Owner payout updated successfully",
    data: payout,
  });
});

// @desc    Delete payout entry (ADMIN ONLY)
// @route   DELETE /api/owner-payout/:id
// @access  Private (Admin Only)
const deletePayout = asyncHandler(async (req, res) => {
  const payout = await OwnerPayout.findById(req.params.id);

  if (!payout) {
    return res.status(404).json({
      success: false,
      message: "Payout record not found",
    });
  }

  const deletedInfo = {
    payoutId: payout.payoutId,
    amount: payout.amount,
    recipientName: payout.recipientName,
  };

  await OwnerPayout.findByIdAndDelete(req.params.id);

  // Log activity
  logActivity({
    req,
    action: "DELETE_OWNER_PAYOUT",
    entityType: "OwnerPayout",
    entityId: req.params.id,
    description: `Admin deleted owner payout ${deletedInfo.payoutId} of ৳${deletedInfo.amount}`,
    metadata: deletedInfo,
  });

  res.status(200).json({
    success: true,
    message: "Owner payout record deleted successfully",
    data: { id: req.params.id },
  });
});

// @desc    Get quick summary of shop net profit & payouts
// @route   GET /api/owner-payout/summary
// @access  Private (Manager, Employee, Admin)
const getPayoutSummary = asyncHandler(async (req, res) => {
  const approvedCondition = {
    status: { $nin: ["Cancelled", "Rejected"] },
    $or: [
      { status: { $in: ["Approved", "Completed"] } },
      { "adminReply.message": { $exists: true, $ne: "" } },
      { handedOverByRole: "admin" },
    ],
  };

  const allApprovedPayouts = await OwnerPayout.find(approvedCondition).lean();

  let totalPaidToOwner = 0;
  allApprovedPayouts.forEach((p) => {
    totalPaidToOwner += Number(p.amount || 0);
  });

  const data = {
    totalPaidToOwner,
    totalTransactions: allApprovedPayouts.length,
  };

  if (req.user.role === "admin") {
    const { shopNetProfit } = await calculateShopNetProfit();
    data.shopNetProfit = Math.round(shopNetProfit * 100) / 100;
    data.remainingProfitBalance = Math.round((shopNetProfit - totalPaidToOwner) * 100) / 100;
  }

  res.status(200).json({
    success: true,
    data,
  });
});

// @desc    Reply to manager's payout feedback (Admin or Manager response)
// @route   POST /api/owner-payout/:id/reply
// @access  Private (Admin, Manager)
const replyPayoutFeedback = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Reply message cannot be empty",
    });
  }

  const payout = await OwnerPayout.findById(req.params.id);
  if (!payout) {
    return res.status(404).json({
      success: false,
      message: "Payout record not found",
    });
  }

  const trimmedMsg = message.trim();
  const newEntry = {
    sender: req.user._id || req.user.id,
    senderName: req.user.name || (req.user.role === "admin" ? "Admin" : "Manager"),
    senderRole: req.user.role || "admin",
    message: trimmedMsg,
    createdAt: new Date(),
  };

  if (!Array.isArray(payout.feedbackThread)) {
    payout.feedbackThread = [];
  }
  payout.feedbackThread.push(newEntry);

  // If Admin replied, update adminReply and mark payout as Approved
  if (req.user.role === "admin") {
    payout.adminReply = {
      message: trimmedMsg,
      repliedBy: req.user._id || req.user.id,
      repliedByName: req.user.name || "Admin",
      repliedAt: new Date(),
    };
    if (payout.status === "Pending") {
      payout.status = "Approved";
      payout.approvedBy = req.user._id || req.user.id;
      payout.approvedByName = req.user.name || "Admin";
      payout.approvedAt = new Date();
    }
  }

  await payout.save();

  logActivity({
    req,
    action: "REPLY_OWNER_PAYOUT",
    entityType: "OwnerPayout",
    entityId: payout._id,
    description: `${req.user.role === "admin" ? "Admin" : "Staff"} replied to payout ${payout.payoutId}: "${trimmedMsg}"`,
    metadata: { payoutId: payout.payoutId, message: trimmedMsg },
  });

  res.status(200).json({
    success: true,
    message: "Reply sent successfully",
    data: payout,
  });
});

// @desc    Approve an owner payout entry (ADMIN ONLY)
// @route   PUT /api/owner-payout/:id/approve
// @access  Private (Admin Only)
const approvePayout = asyncHandler(async (req, res) => {
  const { note } = req.body || {};
  const payout = await OwnerPayout.findById(req.params.id);

  if (!payout) {
    return res.status(404).json({
      success: false,
      message: "Payout record not found",
    });
  }

  payout.status = "Approved";
  payout.approvedBy = req.user._id || req.user.id;
  payout.approvedByName = req.user.name || "Admin";
  payout.approvedAt = new Date();

  const approvalMsg = (note || "Approved and verified by Admin").trim();
  payout.adminReply = {
    message: approvalMsg,
    repliedBy: req.user._id || req.user.id,
    repliedByName: req.user.name || "Admin",
    repliedAt: new Date(),
  };

  if (!Array.isArray(payout.feedbackThread)) {
    payout.feedbackThread = [];
  }
  payout.feedbackThread.push({
    sender: req.user._id || req.user.id,
    senderName: req.user.name || "Admin",
    senderRole: "admin",
    message: approvalMsg,
    createdAt: new Date(),
  });

  await payout.save();

  logActivity({
    req,
    action: "APPROVE_OWNER_PAYOUT",
    entityType: "OwnerPayout",
    entityId: payout._id,
    description: `Admin approved owner payout ${payout.payoutId} of ৳${payout.amount}`,
    metadata: { payoutId: payout.payoutId, amount: payout.amount },
  });

  res.status(200).json({
    success: true,
    message: "Owner payout approved successfully",
    data: payout,
  });
});

module.exports = {
  createPayout,
  getAllPayouts,
  getPayoutById,
  updatePayout,
  deletePayout,
  getPayoutSummary,
  replyPayoutFeedback,
  approvePayout,
};
