/**
 * ============================================================
 * controllers/expenseController.js — Shop Expense Controller
 * ============================================================
 * দোকানের বিভিন্ন আনুষঙ্গিক খরচের এন্ট্রি তৈরি, দেখা, সম্পাদনা
 * ও মুছে ফেলার বিজনেস লজিক হ্যান্ডলার।
 *
 * Rules:
 *  - Manager, Employee, Salesman, Admin → Create & View Expenses
 *  - Admin Only → Edit & Delete Expenses
 * ============================================================
 */
const asyncHandler = require("../utils/asyncHandler");
const Expense = require("../models/Expense");
const { logActivity } = require("../utils/activityLogger");

// @desc    Create a new expense entry
// @route   POST /api/expense
const createExpense = asyncHandler(async (req, res) => {
  const { title, category, otherCategoryDetail, amount, spentBy, purpose, note, date, vendor, vendorName, vendorId } = req.body;

  if (!title || title.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Expense title is required",
    });
  }

  if (!amount || isNaN(amount) || Number(amount) < 0) {
    return res.status(400).json({
      success: false,
      message: "Valid expense amount is required",
    });
  }

  if (!spentBy || spentBy.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Spent by (recipient/staff) is required",
    });
  }

  const expense = await Expense.create({
    title: title.trim(),
    category: category || "Other",
    otherCategoryDetail: (otherCategoryDetail || "").trim(),
    amount: Number(amount),
    spentBy: spentBy.trim(),
    purpose: (purpose || "").trim(),
    note: (note || "").trim(),
    date: date ? new Date(date) : new Date(),
    vendor: vendor || null,
    vendorName: vendorName || "",
    vendorId: vendorId || "",
    createdBy: req.user._id || req.user.id,
    createdByName: req.user.name || "Staff",
    createdByRole: req.user.role || "user",
  });

  // Log activity
  logActivity({
    req,
    action: "CREATE_EXPENSE",
    entityType: "Expense",
    entityId: expense._id,
    description: `Created shop expense: "${expense.title}" of ৳${expense.amount} (Spent by: ${expense.spentBy})`,
    metadata: { title: expense.title, amount: expense.amount, spentBy: expense.spentBy },
  });

  res.status(201).json({
    success: true,
    message: "Expense recorded successfully",
    data: expense,
  });
});

const getAllExpenses = asyncHandler(async (req, res) => {
  const { search, category, role, spentBy, startDate, endDate, page = 1, limit = 50 } = req.query;

  const filter = {};

  if (category && category !== "all") {
    filter.category = category;
  }

  if (role && role !== "all") {
    filter.createdByRole = role.toLowerCase();
  }

  if (spentBy && spentBy !== "all") {
    filter.spentBy = spentBy;
  }

  if (search) {
    filter.$or = [
      { expenseId: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
      { spentBy: { $regex: search, $options: "i" } },
      { purpose: { $regex: search, $options: "i" } },
      { createdByName: { $regex: search, $options: "i" } },
    ];
  }

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

  const skip = (Number(page) - 1) * Number(limit);

  const [rawExpenses, totalCount, allDistinctSpentBy] = await Promise.all([
    Expense.find(filter)
      .populate("createdBy", "name email role")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Expense.countDocuments(filter),
    Expense.distinct("spentBy"),
  ]);

  const expenses = rawExpenses.map((exp, idx) => ({
    ...exp,
    expenseId: exp.expenseId || `EXP-${String(totalCount - (skip + idx)).padStart(5, "0")}`,
  }));

  // Calculate summary statistics (Dynamically based on active filter)
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayAgg, monthAgg, totalAgg, spentByAgg] = await Promise.all([
    Expense.aggregate([
      { $match: { ...filter, date: { ...(filter.date || {}), $gte: startOfToday } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: { ...filter, date: { ...(filter.date || {}), $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$spentBy",
          totalSpent: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalSpent: -1 } },
    ]),
  ]);

  const spentByBreakdown = spentByAgg.map((item) => ({
    name: item._id || "Unknown",
    totalSpent: item.totalSpent || 0,
    count: item.count || 0,
  }));

  const stats = {
    todayExpense: todayAgg[0]?.total || 0,
    monthExpense: monthAgg[0]?.total || 0,
    totalExpense: totalAgg[0]?.total || 0,
    totalCount,
    spentByBreakdown,
    allSpentByUsers: (allDistinctSpentBy || []).filter(Boolean).sort(),
  };

  res.status(200).json({
    success: true,
    data: expenses,
    stats,
    pagination: {
      total: totalCount,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(totalCount / Number(limit)),
    },
  });
});

// @desc    Get expense by ID
// @route   GET /api/expense/:id
// @access  Private
const getExpenseById = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id)
    .populate("createdBy", "name email role")
    .lean();

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Expense record not found",
    });
  }

  res.status(200).json({
    success: true,
    data: expense,
  });
});

// @desc    Update expense entry (Admin Only)
// @route   PUT /api/expense/:id
// @access  Private (Admin Only)
const updateExpense = asyncHandler(async (req, res) => {
  const { title, category, otherCategoryDetail, amount, spentBy, purpose, note, date, vendor, vendorName, vendorId } = req.body;

  const expense = await Expense.findById(req.params.id);

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Expense record not found",
    });
  }

  const oldExpenseState = {
    title: expense.title,
    category: expense.category,
    amount: expense.amount,
    spentBy: expense.spentBy,
    purpose: expense.purpose,
  };

  if (title !== undefined) expense.title = title.trim();
  if (category !== undefined) expense.category = category;
  if (otherCategoryDetail !== undefined) expense.otherCategoryDetail = (otherCategoryDetail || "").trim();
  if (amount !== undefined) expense.amount = Number(amount);
  if (spentBy !== undefined) expense.spentBy = spentBy.trim();
  if (purpose !== undefined) expense.purpose = (purpose || "").trim();
  if (note !== undefined) expense.note = (note || "").trim();
  if (date !== undefined) expense.date = new Date(date);
  if (vendor !== undefined) expense.vendor = vendor || null;
  if (vendorName !== undefined) expense.vendorName = vendorName || "";
  if (vendorId !== undefined) expense.vendorId = vendorId || "";

  await expense.save();

  // Log activity
  logActivity({
    req,
    action: "UPDATE_EXPENSE",
    entityType: "Expense",
    entityId: expense._id,
    description: `Updated shop expense: "${expense.title}" of ৳${expense.amount}`,
    oldValues: oldExpenseState,
    newValues: {
      title: expense.title,
      category: expense.category,
      amount: expense.amount,
      spentBy: expense.spentBy,
      purpose: expense.purpose,
    },
    metadata: { title: expense.title, amount: expense.amount },
  });

  res.status(200).json({
    success: true,
    message: "Expense updated successfully",
    data: expense,
  });
});

// @desc    Delete expense entry (Admin Only)
// @route   DELETE /api/expense/:id
// @access  Private (Admin Only)
const deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Expense record not found",
    });
  }

  const title = expense.title;
  const amount = expense.amount;

  await Expense.findByIdAndDelete(req.params.id);

  // Log activity
  logActivity({
    req,
    action: "DELETE_EXPENSE",
    entityType: "Expense",
    entityId: req.params.id,
    description: `Deleted shop expense: "${title}" of ৳${amount}`,
    metadata: { title, amount },
  });

  res.status(200).json({
    success: true,
    message: "Expense deleted successfully",
  });
});

module.exports = {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
};
