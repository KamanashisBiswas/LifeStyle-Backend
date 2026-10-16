/**
 * ============================================================
 * validations/salesValidation.js — POS Sales Validation Rules
 * ============================================================
 * Admin dashboard থেকে POS (দোকানের কাউন্টার) বিক্রয় তৈরি
 * করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - items[]: অন্তত 1টি cart item থাকতে হবে (productId, variationId, quantity)
 *  - customerPhone: Bangladesh format বা "N/A" (walk-in customer)
 *  - discountType: "flat" বা "percentage" (optional)
 *  - এই ফাইল handleValidation না import করে— inline
 *    validationResult middleware ব্যবহার করে
 *
 * Exported validators:
 *  - validateCreateSale → POST /api/sales
 * ============================================================
 */
const { body, validationResult } = require("express-validator");

// Validation for creating a sale
const validateCreateSale = [
  body("items")
    .isArray({ min: 1 })
    .withMessage("Cart must contain at least one item"),

  body("items.*.productId")
    .notEmpty()
    .withMessage("Product ID is required for each item"),

  body("items.*.variationId")
    .notEmpty()
    .withMessage("Variation ID is required for each item"),

  body("items.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be a positive integer"),

  body("customerName")
    .trim()
    .notEmpty()
    .withMessage("Customer name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Customer name must be between 2 and 100 characters"),

  body("customerPhone")
    .trim()
    .notEmpty()
    .withMessage("Customer phone number is required")
    .custom((value) => {
      // Allow N/A for walk-in customers or validate Bangladesh phone format
      if (value === "N/A" || value === "01300000000") return true;
      return /^(?:\+?88)?01[3-9]\d{8}$/.test(value);
    })
    .withMessage(
      "Please provide a valid Bangladeshi phone number or use 'N/A' for walk-in customers",
    ),

  body("subtotal")
    .isFloat({ min: 0 })
    .withMessage("Subtotal must be a positive number"),

  body("discountType")
    .optional()
    .isIn(["flat", "percentage"])
    .withMessage("Discount type must be either 'flat' or 'percentage'"),

  body("discountValue")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Discount value must be a positive number"),

  body("total")
    .isFloat({ min: 0 })
    .withMessage("Total must be a positive number"),

  // Middleware to handle validation errors
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array().map((err) => ({
          field: err.param,
          message: err.msg,
        })),
      });
    }
    next();
  },
];

module.exports = {
  validateCreateSale,
};
