/**
 * ============================================================
 * routes/return.js — Product Return Routes
 * ============================================================
 * Base path: /api/returns
 *
 * Route সমূহ:
 *  POST /api/returns              → authenticateCustomer, createReturnRequest (Customer)
 *  GET  /api/returns/my-returns   → authenticateCustomer, getMyReturns
 *  GET  /api/returns              → authenticate + authorize(admin/employee), getAllReturns
 *  GET  /api/returns/:id          → authenticate + authorize, getReturnById
 *  PUT  /api/returns/:id          → authenticate + authorize(admin/employee), updateReturnStatus
 *  POST /api/returns/shop-return  → authenticate + authorize(salesman), processShopReturn
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const { check } = require("express-validator");
const {
  authenticate,
  authorize,
  authenticateCustomer,
} = require("../middleware/auth"); // Assuming you have these

const {
  createReturnRequest,
  getMyReturns,
  getAllReturns,
  updateReturnStatus,
  processShopReturn,
} = require("../controllers/returnController");

// Customer Routes
publicRouter.post(
  "/",
  authenticateCustomer,
  [
    check("orderId", "Order ID is required").not().isEmpty(),
    check("productId", "Product ID is required").not().isEmpty(),
    check("quantity", "Quantity must be at least 1").isInt({ min: 1 }),
    check("reason", "Reason is required").not().isEmpty(),
    check("message", "Message is required").not().isEmpty(),
  ],
  createReturnRequest,
);

publicRouter.get("/my-returns", authenticateCustomer, getMyReturns);

// Admin / Employee / Manager Routes
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "returns.view"),
  getAllReturns,
);

adminRouter.put(
  "/:id/status",
  authenticate,
  authorize("admin", "manager", "returns.process"),
  [
    check("status", "Status is required").isIn([
      "pending",
      "approved",
      "received",
      "refunded",
      "rejected",
    ]),
  ],
  updateReturnStatus,
);

// Manager / Admin Routes for shop return
adminRouter.post(
  "/shop-return",
  authenticate,
  authorize("admin", "manager", "shop_returns.create", "shop_returns.view"),
  processShopReturn,
);

module.exports = { publicRouter, adminRouter };
