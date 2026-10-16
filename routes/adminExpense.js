/**
 * ============================================================
 * routes/adminExpense.js — Admin Expense Routes (Admin Only)
 * ============================================================
 * /api/admin-expense এন্ডপয়েন্টসমূহের রাউটিং রেজিস্ট্রি।
 * শুধুমাত্র Admin এক্সেস করতে পারবে।
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  createAdminExpense,
  getAllAdminExpenses,
  getAdminExpenseById,
  updateAdminExpense,
  deleteAdminExpense,
} = require("../controllers/adminExpenseController");

// All admin expense routes require authentication
router.use(authenticate);

router.route("/")
  .post(authorize("admin", "admin_expenses.create"), createAdminExpense)
  .get(authorize("admin", "admin_expenses.view"), getAllAdminExpenses);

router.route("/:id")
  .get(authorize("admin", "admin_expenses.view"), getAdminExpenseById)
  .put(authorize("admin", "admin_expenses.edit"), updateAdminExpense)
  .delete(authorize("admin", "admin_expenses.delete"), deleteAdminExpense);

module.exports = router;
