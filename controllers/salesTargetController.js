/**
 * ============================================================
 * controllers/salesTargetController.js — Sales Target Controller
 * ============================================================
 * Admin & Employee can set targets, view live achievement progress.
 * Manager can view targets and post feedbacks.
 * ============================================================
 */

const asyncHandler = require("../utils/asyncHandler");
const SalesTarget = require("../models/SalesTarget");
const Order = require("../models/Order");
const Return = require("../models/Return");
const User = require("../models/User");

/**
 * Helper: Calculate live sales progress for a given target
 */
const calculateTargetProgress = async (target) => {
  const start = new Date(target.startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(target.endDate);
  end.setHours(23, 59, 59, 999);

  const query = {
    createdAt: { $gte: start, $lte: end },
    status: { $nin: ["cancelled", "refunded"] },
    orderType: "shop", // Strictly only Shop (POS) orders
  };

  // If target is assigned to a specific user (salesman/manager)
  if (target.assignedTo) {
    query.$or = [
      { createdBy: target.assignedTo },
      { salesman: target.assignedTo },
    ];
  }

  const orders = await Order.find(query).select("_id orderId customerName createdAt totalAmount status orderType").lean();

  const totalSales = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  const orderIds = orders.map((o) => o._id);

  let totalReturns = 0;
  if (orderIds.length > 0) {
    const returnDocs = await Return.find({
      order: { $in: orderIds },
      status: { $in: ["received", "refunded", "approved"] },
    }).select("refundAmount").lean();

    totalReturns = returnDocs.reduce((sum, r) => sum + (Number(r.refundAmount) || 0), 0);
  }

  const netSales = Math.max(0, totalSales - totalReturns);
  const ordersCount = orders.length;

  const targetAmount = Number(target.targetAmount) || 1;
  const progressPercent = Math.min(100, Math.round((netSales / targetAmount) * 100));

  const targetOrders = Number(target.targetOrdersCount) || 0;
  const ordersProgressPercent = targetOrders > 0
    ? Math.min(100, Math.round((ordersCount / targetOrders) * 100))
    : 0;

  const remainingAmount = Math.max(0, targetAmount - netSales);

  return {
    achievedAmount: netSales,
    grossSales: totalSales,
    returnAmount: totalReturns,
    achievedOrdersCount: ordersCount,
    progressPercent,
    ordersProgressPercent,
    remainingAmount,
    isTargetReached: netSales >= targetAmount,
  };
};

/**
 * @desc    Get all sales targets with real-time live sales progress
 * @route   GET /api/admin/sales-targets
 * @access  Private (Admin, Employee, Manager)
 */
const getSalesTargets = asyncHandler(async (req, res) => {
  const { status, targetType, orderType, page = 1, limit = 20, pagination } = req.query;

  const filter = {};
  if (status && status !== "all") {
    filter.status = status;
  }
  if (targetType && targetType !== "all") {
    filter.targetType = targetType;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 20);
  const skip = (pageNum - 1) * limitNum;

  const totalItems = await SalesTarget.countDocuments(filter);

  let targetsQuery = SalesTarget.find(filter).sort({ createdAt: -1 });
  if (pagination !== "false") {
    targetsQuery = targetsQuery.skip(skip).limit(limitNum);
  }
  const targets = await targetsQuery.lean();

  // Attach live progress calculation to each target
  const targetsWithProgress = await Promise.all(
    targets.map(async (target) => {
      const progress = await calculateTargetProgress(target);
      return {
        ...target,
        progress,
      };
    })
  );

  // Summary statistics across active targets in database
  const [activeTargetsDocs, allTargetsCount] = await Promise.all([
    SalesTarget.find({ status: "active" }).lean(),
    SalesTarget.countDocuments(),
  ]);

  const activeProgressList = await Promise.all(
    activeTargetsDocs.map((t) => calculateTargetProgress(t))
  );

  const totalTargetAmount = activeTargetsDocs.reduce((sum, t) => sum + (Number(t.targetAmount) || 0), 0);
  const totalAchievedAmount = activeProgressList.reduce((sum, p) => sum + (Number(p?.achievedAmount) || 0), 0);
  const overallProgressPercent = totalTargetAmount > 0
    ? Math.min(100, Math.round((totalAchievedAmount / totalTargetAmount) * 100))
    : 0;

  const stats = {
    totalTargetsCount: allTargetsCount,
    activeTargetsCount: activeTargetsDocs.length,
    totalTargetAmount,
    totalAchievedAmount,
    overallProgressPercent,
  };

  res.status(200).json({
    success: true,
    data: targetsWithProgress,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
      totalItems,
      limit: limitNum,
    },
    stats,
  });
});

/**
 * @desc    Get single sales target by ID
 * @route   GET /api/admin/sales-targets/:id
 * @access  Private (Admin, Employee, Manager)
 */
const getSalesTargetById = asyncHandler(async (req, res) => {
  const target = await SalesTarget.findById(req.params.id).lean();

  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Sales target not found",
    });
  }

  const progress = await calculateTargetProgress(target);

  res.status(200).json({
    success: true,
    data: {
      ...target,
      progress,
    },
  });
});

/**
 * @desc    Create a new sales target
 * @route   POST /api/admin/sales-targets
 * @access  Private (Admin, Employee)
 */
const createSalesTarget = asyncHandler(async (req, res) => {
  const userRole = (req.user?.role || "user").toLowerCase();
  if (!["admin", "employee"].includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only Admin and Employee can create sales targets.",
    });
  }

  const {
    title,
    targetType = "monthly",
    orderType = "shop",
    targetAmount,
    targetOrdersCount = 0,
    startDate,
    endDate,
    assignedTo,
    notes = "",
  } = req.body;

  if (!title || !targetAmount || !startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "Please provide title, target amount, start date, and end date.",
    });
  }

  let assignedToName = "All Managers / General";
  if (assignedTo) {
    const assignedUser = await User.findById(assignedTo).select("name username role").lean();
    if (assignedUser) {
      assignedToName = assignedUser.name || assignedUser.username;
    }
  }

  const target = await SalesTarget.create({
    title: title.trim(),
    targetType,
    orderType,
    targetAmount: Number(targetAmount),
    targetOrdersCount: Number(targetOrdersCount) || 0,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    assignedTo: assignedTo || null,
    assignedToName,
    createdBy: req.user._id,
    createdByName: req.user.name || req.user.username || "Admin",
    createdByRole: userRole,
    notes: notes.trim(),
    feedbacks: [],
  });

  const progress = await calculateTargetProgress(target.toObject());

  res.status(201).json({
    success: true,
    message: "Sales target created successfully!",
    data: {
      ...target.toObject(),
      progress,
    },
  });
});

/**
 * @desc    Update an existing sales target
 * @route   PUT /api/admin/sales-targets/:id
 * @access  Private (Admin, Employee)
 */
const updateSalesTarget = asyncHandler(async (req, res) => {
  const userRole = (req.user?.role || "user").toLowerCase();
  if (!["admin", "employee"].includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only Admin and Employee can update sales targets.",
    });
  }

  const target = await SalesTarget.findById(req.params.id);
  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Sales target not found",
    });
  }

  const {
    title,
    targetType,
    orderType,
    targetAmount,
    targetOrdersCount,
    startDate,
    endDate,
    assignedTo,
    status,
    notes,
  } = req.body;

  if (title) target.title = title.trim();
  if (targetType) target.targetType = targetType;
  if (orderType) target.orderType = orderType;
  if (targetAmount) target.targetAmount = Number(targetAmount);
  if (targetOrdersCount !== undefined) target.targetOrdersCount = Number(targetOrdersCount);
  if (startDate) target.startDate = new Date(startDate);
  if (endDate) target.endDate = new Date(endDate);
  if (status) target.status = status;
  if (notes !== undefined) target.notes = notes.trim();

  if (assignedTo !== undefined) {
    target.assignedTo = assignedTo || null;
    if (assignedTo) {
      const assignedUser = await User.findById(assignedTo).select("name username").lean();
      target.assignedToName = assignedUser ? (assignedUser.name || assignedUser.username) : "Assigned Staff";
    } else {
      target.assignedToName = "All Managers / General";
    }
  }

  await target.save();

  const progress = await calculateTargetProgress(target.toObject());

  res.status(200).json({
    success: true,
    message: "Sales target updated successfully!",
    data: {
      ...target.toObject(),
      progress,
    },
  });
});

/**
 * @desc    Delete a sales target
 * @route   DELETE /api/admin/sales-targets/:id
 * @access  Private (Admin only)
 */
const deleteSalesTarget = asyncHandler(async (req, res) => {
  const userRole = (req.user?.role || "user").toLowerCase();
  if (userRole !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only Admin can delete sales targets.",
    });
  }

  const target = await SalesTarget.findById(req.params.id);
  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Sales target not found",
    });
  }

  await target.deleteOne();

  res.status(200).json({
    success: true,
    message: "Sales target deleted successfully!",
  });
});

/**
 * @desc    Add a feedback comment to a sales target
 * @route   POST /api/admin/sales-targets/:id/feedback
 * @access  Private (Manager, Employee, Admin)
 */
const addTargetFeedback = asyncHandler(async (req, res) => {
  const { comment } = req.body;

  if (!comment || !comment.trim()) {
    return res.status(400).json({
      success: false,
      message: "Feedback comment cannot be empty.",
    });
  }

  const target = await SalesTarget.findById(req.params.id);
  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Sales target not found",
    });
  }

  const userRole = (req.user?.role || "manager").toLowerCase();
  const userName = req.user?.name || req.user?.username || (userRole === "manager" ? "Store Manager" : "Admin");

  const newFeedback = {
    user: req.user._id,
    userName,
    userRole,
    comment: comment.trim(),
    createdAt: new Date(),
  };

  target.feedbacks.push(newFeedback);
  await target.save();

  const progress = await calculateTargetProgress(target.toObject());

  res.status(201).json({
    success: true,
    message: "Feedback submitted successfully!",
    data: {
      ...target.toObject(),
      progress,
    },
  });
});

/**
 * @desc    Delete a feedback comment
 * @route   DELETE /api/admin/sales-targets/:id/feedback/:feedbackId
 * @access  Private (Admin or Feedback Author)
 */
const deleteTargetFeedback = asyncHandler(async (req, res) => {
  const { id, feedbackId } = req.params;
  const userRole = (req.user?.role || "user").toLowerCase();

  const target = await SalesTarget.findById(id);
  if (!target) {
    return res.status(404).json({
      success: false,
      message: "Sales target not found",
    });
  }

  const feedbackIndex = target.feedbacks.findIndex((f) => f._id.toString() === feedbackId);
  if (feedbackIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Feedback comment not found",
    });
  }

  const feedback = target.feedbacks[feedbackIndex];
  if (userRole !== "admin" && feedback.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You can only delete your own feedback comments.",
    });
  }

  target.feedbacks.splice(feedbackIndex, 1);
  await target.save();

  const progress = await calculateTargetProgress(target.toObject());

  res.status(200).json({
    success: true,
    message: "Feedback comment deleted.",
    data: {
      ...target.toObject(),
      progress,
    },
  });
});

module.exports = {
  getSalesTargets,
  getSalesTargetById,
  createSalesTarget,
  updateSalesTarget,
  deleteSalesTarget,
  addTargetFeedback,
  deleteTargetFeedback,
};
