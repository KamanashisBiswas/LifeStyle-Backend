/**
 * ============================================================
 * controllers/leaveController.js — HRM Leave Management Controller
 * ============================================================
 * Manager, Employee, এবং Salesman তাদের নিজস্ব ছুটির আবেদন করতে পারে।
 * ইউজাররা তাদের নিজস্ব ছুটির ইতিহাস দেখতে পারে।
 * অ্যাডমিন সকল ছুটির আবেদন দেখতে এবং Approve/Reject করতে পারেন।
 * ============================================================
 */

const Leave = require("../models/Leave");
const asyncHandler = require("../utils/asyncHandler");

// @desc    Apply for a new leave
// @route   POST /api/hrm/leave or /api/admin/hrm/leave
// @access  Private (Admin, Manager, Employee, Salesman)
const applyLeave = asyncHandler(async (req, res) => {
  const { leaveType, date, fromDate, toDate, reason, comment } = req.body;

  if (!leaveType || !["first_half", "second_half", "long_leave"].includes(leaveType)) {
    return res.status(400).json({
      success: false,
      message: "Please specify a valid leave type (First Half, Second Half, or Long Leave).",
    });
  }

  if (!reason || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: "Reason for leave is required.",
    });
  }

  let finalDate = null;
  let finalFromDate = null;
  let finalToDate = null;
  let totalDays = 1;

  if (leaveType === "first_half" || leaveType === "second_half") {
    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Please select the date for your half-day leave.",
      });
    }
    finalDate = new Date(date);
    totalDays = 0.5;
  } else if (leaveType === "long_leave") {
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "Please select both From Date and To Date for long leave.",
      });
    }
    finalFromDate = new Date(fromDate);
    finalToDate = new Date(toDate);

    if (finalToDate < finalFromDate) {
      return res.status(400).json({
        success: false,
        message: "To Date cannot be earlier than From Date.",
      });
    }

    const diffTime = Math.abs(finalToDate - finalFromDate);
    totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }

  let applicantUser = req.user;
  let appliedByName = "";

  if (req.body.applicantId && (req.user.role === "manager" || req.user.role === "admin")) {
    const User = require("../models/User");
    const targetUser = await User.findById(req.body.applicantId);
    if (targetUser) {
      applicantUser = {
        _id: targetUser._id,
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      };
      appliedByName = `${req.user.name} (${req.user.role})`;
    }
  }

  const newLeave = await Leave.create({
    applicant: applicantUser._id || applicantUser.id,
    applicantName: applicantUser.name || "Employee",
    applicantEmail: applicantUser.email || "",
    applicantRole: applicantUser.role,
    leaveType,
    date: finalDate,
    fromDate: finalFromDate,
    toDate: finalToDate,
    totalDays,
    reason: reason.trim(),
    comment: appliedByName ? `[Applied by: ${appliedByName}] ${comment || ""}`.trim() : (comment || "").trim(),
    status: "pending",
  });

  res.status(201).json({
    success: true,
    message: "Leave application submitted successfully. Awaiting Admin review.",
    data: newLeave,
  });
});

// @desc    Get user's own leave applications
// @route   GET /api/hrm/leave/my-leaves
// @access  Private (Admin, Manager, Employee, Salesman)
const getMyLeaves = asyncHandler(async (req, res) => {
  const { status, role, specificDate, startDate, endDate, period, page = 1, limit = 20 } = req.query;

  // If user is Manager, allow role filtering between manager and salesman
  let query = {};
  if (req.user.role === "manager") {
    if (role === "manager") {
      query = { applicant: req.user._id || req.user.id };
    } else if (role === "salesman") {
      query = { applicantRole: "salesman" };
    } else {
      query = {
        $or: [
          { applicant: req.user._id || req.user.id },
          { applicantRole: "salesman" },
        ],
      };
    }
  } else {
    query = { applicant: req.user._id || req.user.id };
  }

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    query.status = status;
  }

  // Date Filtering (checks date, fromDate, toDate, updatedAt, or createdAt)
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    query.$and = (query.$and || []).concat([
      {
        $or: [
          { date: dateFilterCond },
          { fromDate: dateFilterCond },
          { toDate: dateFilterCond },
          { updatedAt: dateFilterCond },
          { createdAt: dateFilterCond },
        ],
      },
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
          { date: dateRangeCond },
          { fromDate: dateRangeCond },
          { toDate: dateRangeCond },
          { updatedAt: dateRangeCond },
          { createdAt: dateRangeCond },
        ],
      },
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
            { date: { $gte: periodStartDate } },
            { fromDate: { $gte: periodStartDate } },
            { toDate: { $gte: periodStartDate } },
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } },
          ],
        },
      ]);
    }
  }

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const total = await Leave.countDocuments(query);
  const leaves = await Leave.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  res.status(200).json({
    success: true,
    data: leaves,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalRecords: total,
    },
  });
});

// @desc    Get all leave applications (Admin only)
// @route   GET /api/hrm/leave or /api/admin/hrm/leave
// @access  Private (Admin only)
const getAllLeaves = asyncHandler(async (req, res) => {
  const { status, role, search, specificDate, startDate, endDate, period, page = 1, limit = 20 } = req.query;

  const query = {};
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    query.status = status;
  }
  if (role && ["manager", "employee", "salesman", "admin"].includes(role)) {
    query.applicantRole = role;
  }

  // Date Filtering (checks date, fromDate, toDate, updatedAt, or createdAt)
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    query.$and = (query.$and || []).concat([
      {
        $or: [
          { date: dateFilterCond },
          { fromDate: dateFilterCond },
          { toDate: dateFilterCond },
          { updatedAt: dateFilterCond },
          { createdAt: dateFilterCond },
        ],
      },
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
          { date: dateRangeCond },
          { fromDate: dateRangeCond },
          { toDate: dateRangeCond },
          { updatedAt: dateRangeCond },
          { createdAt: dateRangeCond },
        ],
      },
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
            { date: { $gte: periodStartDate } },
            { fromDate: { $gte: periodStartDate } },
            { toDate: { $gte: periodStartDate } },
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } },
          ],
        },
      ]);
    }
  }

  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim(), "i");
    const searchCond = [
      { applicantName: searchRegex },
      { applicantEmail: searchRegex },
      { leaveId: searchRegex },
      { reason: searchRegex },
    ];
    query.$and = (query.$and || []).concat([{ $or: searchCond }]);
  }

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const total = await Leave.countDocuments(query);
  const leaves = await Leave.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  // Calculate Current Month Approved Leave Days and Staff-wise Summary
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // All approved leaves to aggregate staff-wise & monthly statistics
  const approvedLeaves = await Leave.find({ status: "approved" }).lean();

  let totalApprovedDays = 0;
  let currentMonthApprovedDays = 0;
  const staffSummaryMap = {};

  approvedLeaves.forEach((l) => {
    const days = Number(l.totalDays) || (l.leaveType === "long_leave" ? 1 : 0.5);
    totalApprovedDays += days;

    const leaveDate = l.date || l.fromDate || l.createdAt;
    if (leaveDate && new Date(leaveDate) >= currentMonthStart && new Date(leaveDate) <= currentMonthEnd) {
      currentMonthApprovedDays += days;
    }

    const key = String(l.applicant);
    if (!staffSummaryMap[key]) {
      staffSummaryMap[key] = {
        applicantId: l.applicant,
        applicantName: l.applicantName,
        applicantRole: l.applicantRole,
        applicantEmail: l.applicantEmail,
        totalApprovedDays: 0,
        currentMonthDays: 0,
        approvedLeavesCount: 0,
      };
    }

    staffSummaryMap[key].totalApprovedDays += days;
    staffSummaryMap[key].approvedLeavesCount += 1;
    if (leaveDate && new Date(leaveDate) >= currentMonthStart && new Date(leaveDate) <= currentMonthEnd) {
      staffSummaryMap[key].currentMonthDays += days;
    }
  });

  const staffWiseLeaveSummary = Object.values(staffSummaryMap).sort(
    (a, b) => b.totalApprovedDays - a.totalApprovedDays
  );

  // Summary counts for Admin stats
  const [totalPending, totalApproved, totalRejected] = await Promise.all([
    Leave.countDocuments({ status: "pending" }),
    Leave.countDocuments({ status: "approved" }),
    Leave.countDocuments({ status: "rejected" }),
  ]);

  const stats = {
    totalApplications: totalPending + totalApproved + totalRejected,
    total: totalPending + totalApproved + totalRejected,
    pending: totalPending,
    approved: totalApproved,
    rejected: totalRejected,
    totalApprovedDays,
    currentMonthApprovedDays,
    currentMonthName: now.toLocaleString("default", { month: "long", year: "numeric" }),
  };

  res.status(200).json({
    success: true,
    data: leaves,
    stats,
    staffWiseSummary: staffWiseLeaveSummary,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalRecords: total,
    },
  });
});

// @desc    Approve a leave request (Admin only)
// @route   PUT /api/hrm/leave/:id/approve
// @access  Private (Admin only)
const approveLeave = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { adminNotes } = req.body;

  const leave = await Leave.findById(id);
  if (!leave) {
    return res.status(404).json({
      success: false,
      message: "Leave application not found.",
    });
  }

  leave.status = "approved";
  leave.adminNotes = (adminNotes || "").trim();
  leave.reviewedBy = req.user._id || req.user.id;
  leave.reviewedByName = req.user.name || "Admin";
  leave.reviewedAt = new Date();

  await leave.save();

  res.status(200).json({
    success: true,
    message: `Leave request ${leave.leaveId || ""} approved successfully.`,
    data: leave,
  });
});

// @desc    Reject a leave request (Admin only)
// @route   PUT /api/hrm/leave/:id/reject
// @access  Private (Admin only)
const rejectLeave = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { adminNotes } = req.body;

  const leave = await Leave.findById(id);
  if (!leave) {
    return res.status(404).json({
      success: false,
      message: "Leave application not found.",
    });
  }

  leave.status = "rejected";
  leave.adminNotes = (adminNotes || "").trim();
  leave.reviewedBy = req.user._id || req.user.id;
  leave.reviewedByName = req.user.name || "Admin";
  leave.reviewedAt = new Date();

  await leave.save();

  res.status(200).json({
    success: true,
    message: `Leave request ${leave.leaveId || ""} rejected.`,
    data: leave,
  });
});

// @desc    Get staff list for leave application (Manager & Admin)
// @route   GET /api/hrm/leave/staff-list
// @access  Private (Manager, Admin)
const getStaffList = asyncHandler(async (req, res) => {
  const User = require("../models/User");
  
  // Manager can only select Salesman; Admin can select any staff
  const roleFilter = req.user.role === "manager"
    ? ["salesman"]
    : ["salesman", "employee", "manager"];

  const users = await User.find({
    role: { $in: roleFilter },
  })
    .select("name email role avatar")
    .sort({ name: 1 })
    .lean();

  res.status(200).json({
    success: true,
    data: users,
  });
});

module.exports = {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  approveLeave,
  rejectLeave,
  getStaffList,
};
