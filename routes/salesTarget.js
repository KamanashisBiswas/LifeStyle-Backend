/**
 * ============================================================
 * routes/salesTarget.js — Sales Target Routes
 * ============================================================
 * Endpoints for managing Sales Targets and Manager Feedbacks:
 *  - GET    /api/admin/sales-targets           -> Get all targets (Admin, Employee, Manager)
 *  - GET    /api/admin/sales-targets/:id       -> Get single target
 *  - POST   /api/admin/sales-targets           -> Create target (Admin, Employee)
 *  - PUT    /api/admin/sales-targets/:id       -> Update target (Admin, Employee)
 *  - DELETE /api/admin/sales-targets/:id       -> Delete target (Admin only)
 *  - POST   /api/admin/sales-targets/:id/feedback -> Add feedback (Manager, Employee, Admin)
 *  - DELETE /api/admin/sales-targets/:id/feedback/:feedbackId -> Delete feedback
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  getSalesTargets,
  getSalesTargetById,
  createSalesTarget,
  updateSalesTarget,
  deleteSalesTarget,
  addTargetFeedback,
  deleteTargetFeedback,
} = require("../controllers/salesTargetController");

// All sales target routes require authentication
router.use(authenticate);

router
  .route("/")
  .get(authorize("admin", "manager", "salesman", "sales_targets.view"), getSalesTargets)
  .post(authorize("admin", "manager", "sales_targets.create", "sales_targets.manage"), createSalesTarget);

router
  .route("/:id")
  .get(authorize("admin", "manager", "salesman", "sales_targets.view"), getSalesTargetById)
  .put(authorize("admin", "manager", "sales_targets.edit", "sales_targets.manage"), updateSalesTarget)
  .delete(authorize("admin", "sales_targets.delete", "sales_targets.manage"), deleteSalesTarget);

router
  .route("/:id/feedback")
  .post(addTargetFeedback);

router
  .route("/:id/feedback/:feedbackId")
  .delete(deleteTargetFeedback);

module.exports = router;
