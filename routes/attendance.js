/**
 * ============================================================
 * routes/attendance.js — Employee Attendance Routes
 * ============================================================
 * Isolated routes for Employee attendance (check-in, check-out, device)
 * and Admin attendance management (settings, devices, corrections).
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const {
  getMyTodayAttendance,
  registerMyDevice,
  checkIn,
  checkOut,
  getMyAttendanceHistory,
  getAllAttendanceAdmin,
  getMonthlyAttendanceSummary,
  getAttendanceDetails,
  manualCorrection,
  getSettings,
  updateSettings,
  getRegisteredDevices,
  resetDevice,
} = require("../controllers/attendanceController");

const { authenticate, authorize } = require("../middleware/auth");

// ─── Employee Routes (All authenticated staff) ──────────────────────────────
router.get("/today", authenticate, getMyTodayAttendance);
router.post("/device/register", authenticate, registerMyDevice);
router.post("/check-in", authenticate, checkIn);
router.post("/check-out", authenticate, checkOut);
router.get("/history", authenticate, getMyAttendanceHistory);

// ─── Admin Routes ───────────────────────────────────────────────────────────
router.get("/admin", authenticate, authorize("admin", "manager", "attendance.admin"), getAllAttendanceAdmin);
router.get("/monthly-summary", authenticate, authorize("admin", "manager", "attendance.admin"), getMonthlyAttendanceSummary);
router.get("/settings", authenticate, authorize("admin", "attendance.settings"), getSettings);
router.put("/settings", authenticate, authorize("admin", "attendance.settings"), updateSettings);
router.get("/devices", authenticate, authorize("admin", "attendance.devices"), getRegisteredDevices);
router.delete("/devices/:id", authenticate, authorize("admin", "attendance.devices"), resetDevice);

// Single record details & manual correction
router.get("/:id", authenticate, getAttendanceDetails);
router.patch("/:id", authenticate, authorize("admin", "attendance.admin"), manualCorrection);

module.exports = router;
