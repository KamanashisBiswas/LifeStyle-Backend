/**
 * ============================================================
 * routes/sales.js — POS Sales Routes
 * ============================================================
 * Base path: /api/sales
 *
 * Route সমূহ:
 *  POST /api/sales            → authenticate + authorize(salesman/admin/employee), createSale
 *  GET  /api/sales/my-sales   → authenticate + authorize(salesman), getMySales
 *  GET  /api/sales/rewards    → authenticate + authorize(salesman), getSalesmanRewards
 *  GET  /api/sales/shop       → authenticate + authorize(admin/employee), getShopOrders
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const {
  createSale,
  getSalesmanRewards,
  getMySales,
  getShopOrders,
  updateShopOrderPayment,
  getActiveSalesmen,
  resendSaleSMS,
} = require("../controllers/salesController");
const { authenticate, authorize } = require("../middleware/auth");
const { validateCreateSale } = require("../validations/salesValidation");

// @route   GET /api/sales/salesmen
// @desc    Get active salesmen list for POS counter
// @access  Private (Manager, Admin, Employee, Salesman, or pos.sell)
router.get(
  "/salesmen",
  authenticate,
  authorize("admin", "manager", "employee", "salesman", "pos.sell", "pos.my_sell"),
  getActiveSalesmen,
);

// @route   POST /api/sales
// @desc    Create a new POS sale
// @access  Private (Manager, Admin, Employee, Salesman)
router.post(
  "/",
  authenticate,
  authorize("admin", "manager", "employee", "salesman", "pos.sell"),
  validateCreateSale,
  createSale,
);

// @route   GET /api/sales/rewards
// @desc    Get current user's reward points
// @access  Private (Manager, Admin, Employee, Salesman)
router.get(
  "/rewards",
  authenticate,
  authorize("admin", "manager", "employee", "salesman", "pos.my_sell"),
  getSalesmanRewards,
);

// @route   GET /api/sales/my-sales
// @desc    Get all sales made by current user
// @access  Private (Manager, Admin, Employee, Salesman)
router.get(
  "/my-sales",
  authenticate,
  authorize("admin", "manager", "employee", "salesman", "pos.my_sell"),
  getMySales,
);

// @route   GET /api/sales/shop-orders
// @desc    Get all shop orders (POS sales)
// @access  Private (Admin, Employee, Manager)
router.get(
  "/shop-orders",
  authenticate,
  authorize("admin", "employee", "manager", "orders.shop_view"),
  getShopOrders,
);

// @route   PUT /api/sales/shop-orders/:id/payment
// @desc    Update shop order payment method and payments (Admin Only)
// @access  Private (Admin)
router.put(
  "/shop-orders/:id/payment",
  authenticate,
  authorize("admin", "orders.update_status"),
  updateShopOrderPayment,
);

// @route   POST /api/sales/resend-sms/:orderId
// @desc    Resend confirmation SMS to customer for a sale order
// @access  Private (Admin, Manager, Employee, Salesman, or pos.my_sell)
router.post(
  "/resend-sms/:orderId",
  authenticate,
  authorize("admin", "manager", "employee", "salesman", "pos.my_sell", "pos.sell"),
  resendSaleSMS,
);

module.exports = router;
