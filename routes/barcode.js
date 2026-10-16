/**
 * ============================================================
 * routes/barcode.js — Barcode Generation Routes
 * ============================================================
 * Base path: /api/barcode
 *
 * Route সমূহ:
 *  GET /api/barcode/generate             → authenticate + authorize(employee/admin), generateProductBarcodes
 *  GET /api/barcode/single/:productId    → authenticate, generateSingleBarcode
 *  GET /api/barcode/scan/:productId      → authenticate, scanProductForPOS (POS barcode scan)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const {
  generateProductBarcodes,
  scanProductForPOS,
  generateSingleBarcode,
} = require("../controllers/barcodeController");
const { authenticate, authorize } = require("../middleware/auth");

// Generate barcodes for multiple products (with optional range)
router.get(
  "/generate",
  authenticate,
  authorize("admin", "employee", "manager", "products.barcode"),
  generateProductBarcodes,
);

// Generate barcode for single product
router.get(
  "/generate/:productId",
  authenticate,
  authorize("admin", "employee", "manager", "products.barcode"),
  generateSingleBarcode,
);

// Scan barcode for POS system (Admin, Employee, Manager, Salesman, or pos.sell)
router.post(
  "/scan",
  authenticate,
  authorize("admin", "employee", "manager", "salesman", "pos.sell", "products.barcode"),
  scanProductForPOS,
);

module.exports = router;
