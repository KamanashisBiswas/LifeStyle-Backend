const express = require("express");
const router = express.Router();
const { getDashboardStats } = require("../controllers/statsController");
const { authenticate } = require("../middleware/auth");

// @route   GET /api/admin/dashboard
// @desc    Get overview statistics for dashboard
// @access  Private (Authenticated users)
router.get("/", authenticate, getDashboardStats);

module.exports = router;
