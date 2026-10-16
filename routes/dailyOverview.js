/**
 * ============================================================
 * routes/dailyOverview.js — Daily Sales & Expense Overview Routes
 * ============================================================
 * /api/admin/daily-overview এন্ডপয়েন্টসমূহের রাউটিং রেজিস্ট্রি।
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { getDailyOverview } = require("../controllers/dailyOverviewController");

// Require authentication and Admin / Manager role
router.use(authenticate);
router.use(authorize("admin", "daily_overview.view"));

router.get("/", getDailyOverview);

module.exports = router;
