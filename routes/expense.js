/**
 * ============================================================
 * routes/expense.js — Shop Expense Routes
 * ============================================================
 * /api/expense এন্ডপয়েন্টসমূহের রাউটিং রেজিস্ট্রি।
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
} = require("../controllers/expenseController");

// All expense routes require authentication
router.use(authenticate);

router.route("/")
  .post(authorize("admin", "manager", "expenses.create"), createExpense)
  .get(authorize("admin", "manager", "employee", "expenses.view"), getAllExpenses);

router.route("/:id")
  .get(authorize("admin", "manager", "employee", "expenses.view"), getExpenseById)
  .put(authorize("admin", "manager", "expenses.edit"), updateExpense)
  .delete(authorize("admin", "expenses.delete"), deleteExpense);

module.exports = router;
