/**
 * ============================================================
 * routes/vendorReturn.js — Vendor Product Return Routes
 * ============================================================
 * Base path: /api/vendor-return and /api/admin/vendor-return
 */

const express = require("express");
const router = express.Router();
const {
  createVendorReturnRequest,
  getAllVendorReturns,
  getVendorReturnById,
  approveVendorReturn,
  rejectVendorReturn,
} = require("../controllers/vendorReturnController");
const { authenticate, authorize } = require("../middleware/auth");

// All vendor return routes require authentication
router.use(authenticate);

// Create Vendor Return Request & List Vendor Returns
router
  .route("/")
  .post(authorize("admin", "manager", "vendor_returns.create", "vendor_returns.manage"), createVendorReturnRequest)
  .get(authorize("admin", "manager", "vendor_returns.view", "vendor_returns.manage"), getAllVendorReturns);

// Get Single Vendor Return by ID
router.get("/:id", authorize("admin", "manager", "vendor_returns.view", "vendor_returns.manage"), getVendorReturnById);

// Approve Vendor Return & Deduct Stock (Admin, Manager, or vendor_returns.edit)
router.put("/:id/approve", authorize("admin", "manager", "vendor_returns.edit", "vendor_returns.manage"), approveVendorReturn);

// Reject Vendor Return (Admin, Manager, or vendor_returns.edit)
router.put("/:id/reject", authorize("admin", "manager", "vendor_returns.edit", "vendor_returns.manage"), rejectVendorReturn);

module.exports = router;
