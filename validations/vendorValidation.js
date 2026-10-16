/**
 * ============================================================
 * validations/vendorValidation.js — Vendor Validation Rules
 * ============================================================
 * Supplier/vendor (সরবরাহকারী) তৈরি ও আপডেট করার সময়
 * input validate করার জন্য এই ফাইলের rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - phone: Bangladesh format (01XXXXXXXXX বা +8801XXXXXXXXX)
 *  - address: 5 থেকে 500 characters এর মধ্যে
 *
 * Exported validators:
 *  - createVendorValidation → POST /api/vendor
 *  - updateVendorValidation → PUT /api/vendor/:id
 *  - paramIdValidation      → DELETE/GET /api/vendor/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

const createVendorValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Vendor name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Vendor name must be between 2 and 100 characters"),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Vendor phone number is required")
    .matches(/^(\+8801|01)[3-9]\d{8}$/)
    .withMessage("Please provide a valid Bangladeshi phone number"),
  body("address")
    .trim()
    .notEmpty()
    .withMessage("Vendor address is required")
    .isLength({ min: 5, max: 500 })
    .withMessage("Vendor address must be between 5 and 500 characters"),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value (true or false)"),

  handleValidation,
];

const updateVendorValidation = [
  param("id").notEmpty().withMessage("Vendor ID is required"),
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Vendor name must be between 2 and 100 characters"),
  body("phone")
    .optional()
    .trim()
    .matches(/^(\+8801|01)[3-9]\d{8}$/)
    .withMessage("Please provide a valid Bangladeshi phone number"),
  body("address")
    .optional()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("Vendor address must be between 5 and 500 characters"),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value (true or false)"),
  handleValidation,
];

const paramIdValidation = [
  param("id").notEmpty().withMessage("Vendor ID is required in URL"),
  handleValidation,
];

module.exports = {
  createVendorValidation,
  updateVendorValidation,
  paramIdValidation,
};
