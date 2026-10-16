/**
 * ============================================================
 * validations/couponValidation.js — Coupon Validation Rules
 * ============================================================
 * Discount coupon (ডিসকাউন্ট কুপন) তৈরি ও আপডেট করার সময়
 * input validate করার জন্য এই ফাইলের validation rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - coupon code unique হতে হবে (DB query দিয়ে check)
 *  - type: "Percentage" বা "Fixed" হতে হবে
 *  - startTime ও endTime optional (ISO 8601 format)
 *  - discountValue: positive number হতে হবে
 *
 * Exported validators:
 *  - validateCreateCoupon → POST /api/coupon
 *  - validateUpdateCoupon → PATCH /api/coupon/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const Coupon = require("../models/Coupon"); // Coupon model — duplicate code check এর জন্য

const validateCreateCoupon = [
  body("code")
    .trim()
    .notEmpty()
    .withMessage("Coupon code is required")
    .isLength({ max: 50 })
    .withMessage("Code cannot exceed 50 characters")
    .custom(async (value) => {
      const existing = await Coupon.findOne({ code: value });
      if (existing) throw new Error("Coupon code already exists");
      return true;
    }),
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 200 })
    .withMessage("Title cannot exceed 200 characters"),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ max: 2000 })
    .withMessage("Description cannot exceed 2000 characters"),
  body("type")
    .notEmpty()
    .withMessage("Type is required")
    .isIn(["Percentage", "Fixed"])
    .withMessage("Type must be Percentage or Fixed"),
  body("startTime")
    .optional()
    .isISO8601()
    .withMessage("Invalid start time format"),
  body("endTime").optional().isISO8601().withMessage("Invalid end time format"),
  body("isActive")
    .not()
    .isEmpty()
    .withMessage("isActive status is required")
    .isBoolean()
    .withMessage("isActive must be a boolean value")
    .toBoolean(),
  body("discountValue")
    .notEmpty()
    .withMessage("Discount value is required")
    .isFloat({ min: 0 })
    .withMessage("Discount value must be a positive number"),
  handleValidation,
];

const validateUpdateCoupon = [
  body("code")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Code cannot exceed 50 characters"),
  body("title")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Title cannot exceed 200 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Description cannot exceed 2000 characters"),
  body("type")
    .optional()
    .isIn(["Percentage", "Fixed"])
    .withMessage("Type must be Percentage or Fixed"),
  body("startTime")
    .optional()
    .isISO8601()
    .withMessage("Invalid start time format"),
  body("endTime").optional().isISO8601().withMessage("Invalid end time format"),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value")
    .toBoolean(),
  body("discountValue")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Discount value must be a positive number"),
  handleValidation,
];

const validateCouponId = [
  param("id").notEmpty().withMessage("Coupon ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateCoupon,
  validateUpdateCoupon,
  validateCouponId,
};
