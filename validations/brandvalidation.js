/**
 * ============================================================
 * validations/brandvalidation.js — Brand Validation Rules
 * ============================================================
 * Brand (ব্র্যান্ড) তৈরি ও আপডেট করার সময় input validate করার
 * জন্য এই ফাইলের validation rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - create করার সময় image (req.file) আবশ্যক — checkBrandImage
 *    middleware দিয়ে চেক করা হয়
 *  - brand name unique হতে হবে (case-insensitive DB query)
 *
 * Exported validators:
 *  - validateCreateBrand → POST /api/brand
 *  - validateUpdateBrand → PATCH /api/brand/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const Brand = require("../models/Brand"); // Brand model — duplicate name check এর জন্য

const checkBrandImage = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "image", message: "Brand image is required" }],
    });
  }
  next();
};

const validateCreateBrand = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Brand name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Brand name must be between 3 and 50 characters")
    .custom(async (value) => {
      const existing = await Brand.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
      });
      if (existing) {
        throw new Error("Brand name already exists");
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("isActive").isBoolean().withMessage("isActive must be a boolean value"),

  checkBrandImage,
  handleValidation,
];

const validateUpdateBrand = [
  param("id").notEmpty().withMessage("Brand ID is required in URL"),

  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage("Brand name must be between 3 and 50 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),

  handleValidation,
];

const validateBrandId = [
  param("id").notEmpty().withMessage("Brand ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateBrand,
  validateUpdateBrand,
  validateBrandId,
};
