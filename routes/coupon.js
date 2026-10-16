/**
 * ============================================================
 * routes/coupon.js — Coupon Routes
 * ============================================================
 * Base path: /api/coupon
 *
 * Route সমূহ:
 *  POST   /api/coupon           → authenticate + authorize(employee/admin), createCoupon
 *  GET    /api/coupon           → authenticate + authorize, getAllCoupons
 *  GET    /api/coupon/:id       → authenticate, getCouponById
 *  PUT    /api/coupon/:id       → authenticate + authorize(employee/admin), updateCoupon
 *  DELETE /api/coupon/:id       → authenticate + authorize(admin), deleteCoupon
 *  POST   /api/coupon/validate  → Public, validateCoupon (Customer checkout ঊ code check)
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createCoupon,
  getAllCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
} = require("../controllers/couponController");

const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateCoupon,
  validateUpdateCoupon,
  validateCouponId,
} = require("../validations/couponValidation");

// Create Coupon (Employee, Admin, coupons.create, or coupons.manage)
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "coupons.create", "coupons.manage"),
  validateCreateCoupon,
  createCoupon,
);

// Get All Coupons (Employee, Admin, coupons.view, or coupons.manage)
adminRouter.get("/", authenticate, authorize("admin", "employee", "coupons.view", "coupons.manage"), getAllCoupons);

// Get Single Coupon by couponId
adminRouter.get(
  "/:id",
  authenticate,
  authorize("admin", "employee", "coupons.view", "coupons.manage"),
  validateCouponId,
  getCouponById,
);

// Update Coupon
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "coupons.edit", "coupons.manage"),
  validateUpdateCoupon,
  updateCoupon,
);

// Delete Coupon (Admin or coupons.delete)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "coupons.delete"),
  validateCouponId,
  deleteCoupon,
);

// Validate Coupon (public, for checkout)
publicRouter.post("/validate", validateCoupon);

module.exports = { publicRouter, adminRouter };
