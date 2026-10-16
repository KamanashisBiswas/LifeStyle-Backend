/**
 * ============================================================
 * validations/colorValidation.js — Color Validation Rules
 * ============================================================
 * Product color (রঙ) তৈরি ও আপডেট করার সময় input validate করার
 * জন্য এই ফাইলের validation rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - create করার সময় image (req.file) আবশ্যক — checkColorImage
 *  - color name unique হতে হবে (case-insensitive DB query)
 *
 * Exported validators:
 *  - validateCreateColor → POST /api/color
 *  - validateUpdateColor → PATCH /api/color/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const Color = require("../models/Color"); // Color model — duplicate name check এর জন্য

const checkColorImage = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "image", message: "Color image is required" }],
    });
  }
  next();
};

const validateCreateColor = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Color name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Color name must be between 2 and 50 characters")
    .custom(async (value) => {
      const existing = await Color.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
      });
      if (existing) {
        throw new Error("Color name already exists");
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("isActive").isBoolean().withMessage("isActive must be a boolean value"),

  checkColorImage,
  handleValidation,
];

const validateUpdateColor = [
  param("id").notEmpty().withMessage("Color ID is required in URL"),

  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Color name must be between 2 and 50 characters")
    .custom(async (value, { req }) => {
      const existing = await Color.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
      });
      if (existing && existing.colorId !== req.params.id) {
        throw new Error("Color name already exists");
      }
      return true;
    }),

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

const validateColorId = [
  param("id")
    .notEmpty()
    .withMessage("Color ID is required")
    .matches(/^CLR-\d{5}$/)
    .withMessage("Invalid color ID format"),
  handleValidation,
];

module.exports = {
  validateCreateColor,
  validateUpdateColor,
  validateColorId,
};
