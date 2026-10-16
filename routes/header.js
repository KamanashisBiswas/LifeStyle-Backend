/**
 * ============================================================
 * routes/header.js — Website Header Routes
 * ============================================================
 * Base path: /api/header
 *
 * Route সমূহ:
 *  POST   /api/header        → authenticate + authorize(employee/admin), createHeader
 *  GET    /api/header        → Public, getHeader (single active header)
 *  GET    /api/header/all    → authenticate, getAllHeaders
 *  PUT    /api/header/:id    → authenticate + authorize(employee/admin), updateHeader
 *  DELETE /api/header/:id    → authenticate + authorize(admin), deleteHeader
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const {
  createHeader,
  getHeader,
  getAllHeaders,
  updateHeader,
  deleteHeader,
} = require("../controllers/headerController");
const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateHeader,
  validateUpdateHeader,
} = require("../validations/headerValidation");

// Get Header (public)
publicRouter.get("/", getHeader);

// Get all headers (admin/employee)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "cms.view"),
  getAllHeaders,
);

// Create Header (admin/employee, only one allowed)
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "cms.create", "cms.manage"),
  validateCreateHeader,
  createHeader,
);

// Update Header (admin/employee) by headerId
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "cms.edit", "cms.manage"),
  validateUpdateHeader,
  updateHeader,
);

// Delete Header (admin)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "cms.delete", "cms.manage"), // Only admin can delete
  deleteHeader,
);

module.exports = { publicRouter, adminRouter };
