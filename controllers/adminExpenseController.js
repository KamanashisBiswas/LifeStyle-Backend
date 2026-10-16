/**
 * ============================================================
 * controllers/adminExpenseController.js — Admin Expense Controller
 * ============================================================
 * অ্যাডমিনের নিজস্ব খরচের এন্ট্রি তৈরি, দেখা, সম্পাদনা ও মুছে ফেলার
 * সম্পূর্ণ আলাদা কন্ট্রোলার। (Only Admin Allowed)
 * ============================================================
 */
const asyncHandler = require("../utils/asyncHandler");
const AdminExpense = require("../models/AdminExpense");
const { logActivity } = require("../utils/activityLogger");

// @desc    Create a new admin expense entry (Admin Only)
// @route   POST /api/admin-expense
const createAdminExpense = asyncHandler(async (req, res) => {
  const { title, category, otherCategoryDetail, amount, spentBy, purpose, note, date } = req.body;

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

  const expense = await AdminExpense.create({
    title: title.trim(),
    category: category || "Other",
    otherCategoryDetail: (otherCategoryDetail || "").trim(),
    amount: Number(amount),
    spentBy: spentBy.trim(),
    purpose: (purpose || "").trim(),
    note: (note || "").trim(),
    date: date ? new Date(date) : new Date(),
    createdBy: req.user._id || req.user.id,
    createdByName: req.user.name || "Admin",
    createdByRole: req.user.role || "admin",
  });

  logActivity({
    req,
    action: "CREATE_ADMIN_EXPENSE",
    entityType: "AdminExpense",
    entityId: expense._id,
    description: `Created admin personal expense: "${expense.title}" of ৳${expense.amount} (Spent by: ${expense.spentBy})`,
    metadata: { title: expense.title, amount: expense.amount, spentBy: expense.spentBy },
  });

  res.status(201).json({
    success: true,
    message: "Admin expense recorded successfully",
    data: expense,
  });
});

// @desc    Get all admin expenses with filters & summary statistics (Admin Only)
// @route   GET /api/admin-expense
const getAllAdminExpenses = asyncHandler(async (req, res) => {
  const { search, category, startDate, endDate, page = 1, limit = 50 } = req.query;

  const filter = {};

  if (category && category !== "all") {
    filter.category = category;
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

  const [rawExpenses, totalCount] = await Promise.all([
    AdminExpense.find(filter)
      .populate("createdBy", "name email role")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    AdminExpense.countDocuments(filter),
  ]);

  const expenses = rawExpenses.map((exp, idx) => ({
    ...exp,
    expenseId: exp.expenseId || `AEXP-${String(totalCount - (skip + idx)).padStart(5, "0")}`,
  }));

  // Summary statistics
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todayAgg, monthAgg, totalAgg, spentByAgg] = await Promise.all([
    AdminExpense.aggregate([
      {
        $match: {
          ...filter,
          $or: [
            { date: { ...(filter.date || {}), $gte: startOfToday } },
            { createdAt: { $gte: startOfToday } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    AdminExpense.aggregate([
      {
        $match: {
          ...filter,
          $or: [
            { date: { ...(filter.date || {}), $gte: startOfMonth } },
            { createdAt: { $gte: startOfMonth } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    AdminExpense.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    AdminExpense.aggregate([
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

// @desc    Get admin expense by ID (Admin Only)
// @route   GET /api/admin-expense/:id
const getAdminExpenseById = asyncHandler(async (req, res) => {
  const expense = await AdminExpense.findById(req.params.id)
    .populate("createdBy", "name email role")
    .lean();

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Admin expense record not found",
    });
  }

  res.status(200).json({
    success: true,
    data: expense,
  });
});

// @desc    Update admin expense entry (Admin Only)
// @route   PUT /api/admin-expense/:id
const updateAdminExpense = asyncHandler(async (req, res) => {
  const { title, category, otherCategoryDetail, amount, spentBy, purpose, note, date } = req.body;

  const expense = await AdminExpense.findById(req.params.id);

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Admin expense record not found",
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

  await expense.save();

  logActivity({
    req,
    action: "UPDATE_ADMIN_EXPENSE",
    entityType: "AdminExpense",
    entityId: expense._id,
    description: `Updated admin expense: "${expense.title}" of ৳${expense.amount}`,
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
    message: "Admin expense updated successfully",
    data: expense,
  });
});

// @desc    Delete admin expense entry (Admin Only)
// @route   DELETE /api/admin-expense/:id
const deleteAdminExpense = asyncHandler(async (req, res) => {
  const expense = await AdminExpense.findById(req.params.id);

  if (!expense) {
    return res.status(404).json({
      success: false,
      message: "Admin expense record not found",
    });
  }

  const title = expense.title;
  const amount = expense.amount;

  await AdminExpense.findByIdAndDelete(req.params.id);

  logActivity({
    req,
    action: "DELETE_ADMIN_EXPENSE",
    entityType: "AdminExpense",
    entityId: req.params.id,
    description: `Deleted admin expense: "${title}" of ৳${amount}`,
    metadata: { title, amount },
  });

  res.status(200).json({
    success: true,
    message: "Admin expense deleted successfully",
  });
});

module.exports = {
  createAdminExpense,
  getAllAdminExpenses,
  getAdminExpenseById,
  updateAdminExpense,
  deleteAdminExpense,
};
