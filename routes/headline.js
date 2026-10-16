/**
 * ============================================================
 * routes/headline.js — Scrolling Headline Routes
 * ============================================================
 * Base path: /api/headline
 *
 * Route সমূহ:
 *  POST   /api/headline        → authenticate + authorize(employee/admin), createHeadline
 *  GET    /api/headline        → Public, getHeadline (active headline)
 *  GET    /api/headline/all    → authenticate, getAllHeadlines
 *  GET    /api/headline/admin  → authenticate + authorize, getAllHeadlinesAdmin
 *  GET    /api/headline/:id    → authenticate, getHeadlineById
 *  PUT    /api/headline/:id    → authenticate + authorize(employee/admin), updateHeadline
 *  DELETE /api/headline/:id    → authenticate + authorize(admin), deleteHeadline
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createHeadline,
  getAllHeadlines,
  getHeadlineById,
  updateHeadline,
  deleteHeadline,
  getAllHeadlinesAdmin,
} = require("../controllers/headlineController");

const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateHeadline,
  validateUpdateHeadline,
  validateHeadlineId,
} = require("../validations/headlineValidation");

// Create Headline (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("employee", "admin", "cms.create", "cms.manage"),
  validateCreateHeadline,
  createHeadline,
);

// Get All Headlines (Public, only active)
publicRouter.get("/", getAllHeadlines);

// Get All Headlines (admin/employee, including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("employee", "admin", "cms.view"),
  getAllHeadlinesAdmin,
);

// Get Headline by custom ID (Public)
publicRouter.get("/:id", validateHeadlineId, getHeadlineById);

// Update Headline (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("employee", "admin", "cms.edit", "cms.manage"),
  validateUpdateHeadline,
  updateHeadline,
);

// Delete Headline (Admin only)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "cms.delete", "cms.manage"),
  validateHeadlineId,
  deleteHeadline,
);

module.exports = { publicRouter, adminRouter };
