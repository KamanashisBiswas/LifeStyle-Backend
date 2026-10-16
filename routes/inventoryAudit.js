/**
 * ============================================================
 * routes/inventoryAudit.js — Inventory Physical Audit Routes
 * ============================================================
 * Base path: /api/inventory-audit
 *
 * Routes:
 *  POST /api/inventory-audit/scan   → Scan SKU/Barcode for physical audit
 *  POST /api/inventory-audit        → Save audit session
 *  GET  /api/inventory-audit        → Get list of all audit sessions
 *  GET  /api/inventory-audit/:id    → Get single audit session with items
 *  DELETE /api/inventory-audit/:id → Delete audit session (admin only)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const {
  scanSkuForAudit,
  saveAuditSession,
  getAllAuditSessions,
  getAuditSessionById,
  deleteAuditSession,
  getDatabaseTotalStock,
} = require("../controllers/inventoryAuditController");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get total store stock across entire database
router.get(
  "/db-stock",
  authorize("admin", "manager", "employee", "inventory.check"),
  getDatabaseTotalStock
);

// Scan SKU for audit (Admin, Manager, Employee, or inventory.check)
router.post(
  "/scan",
  authorize("admin", "manager", "employee", "inventory.check"),
  scanSkuForAudit
);

// Save audit session (Admin, Manager, Employee, or inventory.check)
router.post(
  "/",
  authorize("admin", "manager", "employee", "inventory.check"),
  saveAuditSession
);

// Get all audit sessions (Admin, Manager, Employee, or inventory.check)
router.get(
  "/",
  authorize("admin", "manager", "employee", "inventory.check"),
  getAllAuditSessions
);

// Get audit session details by ID
router.get(
  "/:id",
  authorize("admin", "manager", "employee", "inventory.check"),
  getAuditSessionById
);

// Delete audit session (Admin only)
router.delete(
  "/:id",
  authorize("admin"),
  deleteAuditSession
);

module.exports = router;
