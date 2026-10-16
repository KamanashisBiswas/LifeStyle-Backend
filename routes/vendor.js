/**
 * ============================================================
 * routes/vendor.js — Vendor/Supplier Routes
 * ============================================================
 * Base path: /api/vendor
 *
 * Route সমূহ:
 *  POST   /api/vendor           → authenticate + authorize(employee/admin), createVendor
 *  GET    /api/vendor           → authenticate, getAllVendors (সার্চ/filter/pagination)
 *  GET    /api/vendor/:id       → authenticate, getVendorById
 *  PUT    /api/vendor/:id       → authenticate + authorize(employee/admin), updateVendor
 *  PATCH  /api/vendor/:id/toggle → authenticate + authorize, toggleVendorStatus (active/inactive)
 *  DELETE /api/vendor/:id       → authenticate + authorize(admin), deleteVendor
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const {
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  toggleVendorStatus,
} = require("../controllers/vendorController");

const {
  createVendorValidation,
  updateVendorValidation,
  paramIdValidation,
} = require("../validations/vendorValidation");

const { authenticate, authorize } = require("../middleware/auth");

// Create Vendor (Admin, Employee, vendors.create, or vendors.manage)
router.post(
  "/",
  authenticate,
  authorize("admin", "employee", "vendors.create", "vendors.manage"),
  createVendorValidation,
  createVendor,
);

// Get All Vendors (Admin, Employee, Manager, vendors.view, vendors.manage, or purchases.view)
router.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "vendors.view", "vendors.manage", "purchases.view", "purchases.create"),
  getAllVendors,
);

// Get Vendor by ID (Admin, Employee, vendors.view, or vendors.manage)
router.get(
  "/:id",
  authenticate,
  authorize("admin", "employee", "vendors.view", "vendors.manage"),
  paramIdValidation,
  getVendorById,
);

// Update Vendor (Admin, Employee, vendors.edit, or vendors.manage)
router.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "vendors.edit", "vendors.manage"),
  updateVendorValidation,
  updateVendor,
);

// Toggle Vendor Status (Admin, Employee, vendors.edit, or vendors.manage)
router.patch(
  "/:id/toggle-status",
  authenticate,
  authorize("admin", "employee", "vendors.edit", "vendors.manage"),
  paramIdValidation,
  toggleVendorStatus,
);

// Delete Vendor (Admin Only or vendors.delete)
router.delete(
  "/:id",
  authenticate,
  authorize("admin", "vendors.delete"),
  paramIdValidation,
  deleteVendor,
);

module.exports = router;
