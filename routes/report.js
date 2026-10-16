/**
 * ============================================================
 * routes/report.js — Reports API Route
 * ============================================================
 * GET /api/admin/reports → Custom filtered analytics & report generation
 * Authorized roles: Admin, Employee, Manager
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { getReports, getSalesmanDetails, compareReports } = require("../controllers/reportController");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);
router.use(authorize("admin", "reports.view"));

router.get("/", getReports);
router.get("/salesman-details", authorize("admin", "reports.details"), getSalesmanDetails);
router.post("/compare", authorize("admin", "reports.compare"), compareReports);
router.get("/compare", authorize("admin", "reports.compare"), compareReports);

module.exports = router;
