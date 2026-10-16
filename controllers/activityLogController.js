const ActivityLog = require("../models/ActivityLog");
const asyncHandler = require("../utils/asyncHandler");

/**
 * @desc    Get paginated activity logs for Admin dashboard
 * @route   GET /api/admin/activity-logs
 * @access  Private (Admin Only)
 */
const getActivityLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    role = "",
    employeeId = "",
    entityType = "",
    action = "",
    startDate = "",
    endDate = "",
  } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Build query filter (Strictly filter for "employee" role only)
  const query = {
    userRole: "employee"
  };

  const { category } = req.query;

  if (category) {
    if (category === "AUTH") {
      query.action = { $in: ["LOGIN", "LOGOUT"] };
    } else if (category === "PRODUCT") {
      query.entityType = "Product";
    } else if (category === "CATEGORY") {
      query.entityType = { $in: ["Category", "SubCategory"] };
    } else if (category === "BRAND_VENDOR") {
      query.entityType = { $in: ["Brand", "Vendor"] };
    } else if (category === "ORDER") {
      query.entityType = "Order";
    } else if (category === "SALE") {
      query.entityType = "Sale";
    } else if (category === "RETURN") {
      query.entityType = "Return";
    } else if (category === "COUPON") {
      query.entityType = { $in: ["Coupon", "OfferDeal"] };
    }
  }

  if (employeeId) {
    query.user = employeeId;
  }

  if (entityType) {
    query.entityType = entityType;
  }

  if (action) {
    query.action = action;
  }

  // Date range filter
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query.createdAt.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  // Text search filter
  if (search && search.trim() !== "") {
    const searchRegex = new RegExp(search.trim(), "i");
    query.$or = [
      { userName: searchRegex },
      { userEmail: searchRegex },
      { description: searchRegex },
      { action: searchRegex },
      { entityId: searchRegex },
    ];
  }

  // Fetch paginated logs
  const [logs, totalLogs] = await Promise.all([
    ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  // Today start date for stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Summary stats calculations (Filtered strictly for employee role)
  const [todayLogsCount, activeStaffCount] = await Promise.all([
    ActivityLog.countDocuments({ userRole: "employee", createdAt: { $gte: todayStart } }),
    ActivityLog.distinct("user", { userRole: "employee", createdAt: { $gte: todayStart } }),
  ]);

  const stats = {
    totalLogs,
    total: totalLogs,
    todayLogs: todayLogsCount,
    activeStaffToday: activeStaffCount.length,
  };

  res.status(200).json({
    success: true,
    data: logs,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalLogs / limitNum) || 1,
      totalLogs,
      limit: limitNum,
    },
    stats,
  });
});

// @desc    Delete single activity log (Admin only)
// @route   DELETE /api/admin/activity-logs/:id
// @access  Private (Admin)
const deleteActivityLog = asyncHandler(async (req, res) => {
  const log = await ActivityLog.findByIdAndDelete(req.params.id);

  if (!log) {
    return res.status(404).json({
      success: false,
      message: "Activity log record not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Activity log record deleted successfully",
  });
});

// @desc    Clear all activity logs (Admin only)
// @route   DELETE /api/admin/activity-logs
// @access  Private (Admin)
const clearAllActivityLogs = asyncHandler(async (req, res) => {
  await ActivityLog.deleteMany({});

  res.status(200).json({
    success: true,
    message: "All activity logs cleared successfully",
  });
});

module.exports = {
  getActivityLogs,
  deleteActivityLog,
  clearAllActivityLogs,
};
