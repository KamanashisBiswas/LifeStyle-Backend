/**
 * ============================================================
 * routes/leave.js — HRM Leave Management Routes
 * ============================================================
 * /api/hrm/leave এবং /api/admin/hrm/leave এর সমস্ত এন্ডপয়েন্ট।
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  approveLeave,
  rejectLeave,
  getStaffList,
} = require("../controllers/leaveController");

// All routes require authenticated staff (Admin, Manager, Employee, Salesman)
router.use(authenticate);

// Staff apply for leave & view their own applications
router.post("/apply", applyLeave);
router.get("/my-leaves", getMyLeaves);
router.get("/staff-list", getStaffList);

// Endpoints to manage & review leaves (Admin, Manager, or staff with leaves.view/leaves.manage)
router.get("/", authorize("admin", "manager", "leaves.view", "leaves.manage"), getAllLeaves);
router.put("/:id/approve", authorize("admin", "manager", "leaves.manage"), approveLeave);
router.put("/:id/reject", authorize("admin", "manager", "leaves.manage"), rejectLeave);

module.exports = router;
