/**
 * ============================================================
 * routes/exchange.js — Replace / Exchange Routes
 * ============================================================
 * Base path: /api/exchange
 *
 * Authorization rules:
 *  - POST /api/exchange                → authenticate + authorize("admin", "manager")
 *  - GET  /api/exchange                → authenticate + authorize("admin", "manager", "employee")
 *  - GET  /api/exchange/order/:orderId → authenticate + authorize("admin", "manager", "employee")
 *  - GET  /api/exchange/:id            → authenticate + authorize("admin", "manager", "employee")
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  processExchange,
  getOrderForExchange,
  getExchanges,
  getExchangeById,
} = require("../controllers/exchangeController");

// Process new Replace / Exchange (Admin, Manager, or staff with exchanges.create)
router.post(
  "/",
  authenticate,
  authorize("admin", "manager", "exchanges.create", "exchanges.view"),
  processExchange
);

// Get Exchanges list & summary (Admin, Manager, Employee, or exchanges.view)
router.get(
  "/",
  authenticate,
  authorize("admin", "manager", "employee", "exchanges.view"),
  getExchanges
);

// Search Order details for Exchange (Admin, Manager, Employee, or exchanges.view)
router.get(
  "/order/:orderId",
  authenticate,
  authorize("admin", "manager", "employee", "exchanges.view"),
  getOrderForExchange
);

// Get Exchange details by ID (Admin, Manager, Employee, or exchanges.view)
router.get(
  "/:id",
  authenticate,
  authorize("admin", "manager", "employee", "exchanges.view"),
  getExchangeById
);

module.exports = router;
