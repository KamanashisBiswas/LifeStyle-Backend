/**
 * ============================================================
 * validations/categoryValidation.js — Category Validation Rules
 * ============================================================
 * Product category (পণ্য বিভাগ) তৈরি ও আপডেট করার সময় input
 * validate করার জন্য এই ফাইলের validation rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - create করার সময় image (req.file) আবশ্যক — checkCategoryImage
 *  - update করার সময় DB-তে image না থাকলে এবং নতুন file না দিলে
 *    error — checkCategoryImageOnUpdate
 *  - category name unique হতে হবে (case-insensitive DB query)
 *
 * Exported validators:
 *  - validateCreateCategory → POST /api/category
 *  - validateUpdateCategory → PATCH /api/category/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const Category = require("../models/Category");
const mongoose = require("mongoose");

// Custom middleware to check image file for create
const checkCategoryImage = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "image", message: "Category image is required" }],
    });
  }
  next();
};

// Custom middleware to check image file for update (optional, but required if not already present)
const checkCategoryImageOnUpdate = async (req, res, next) => {
  // Only check if no image in DB and no new file uploaded
  const CategoryModel = require("../models/Category");
  const category = await CategoryModel.findOne({ categoryId: req.params.id });
  if (!category) return next(); // Let not found be handled elsewhere

  if (!category.image && !req.file) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "image", message: "Category image is required" }],
    });
  }
  next();
};

const validateCreateCategory = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Category name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Category name must be between 3 and 50 characters")
    .custom(async (value) => {
      const existing = await Category.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
      });
      if (existing) {
        throw new Error("Category name already exists");
      }
      return true;
    }),

  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("isActive")
    .exists()
    .withMessage("isActive status is required")
    .toBoolean()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),

  checkCategoryImage,
  handleValidation,
];

const validateUpdateCategory = [
  param("id").notEmpty().withMessage("Category ID is required in URL"),

  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage("Category name must be between 3 and 50 characters")
    .custom(async (value, { req }) => {
      if (!value) return true;
      const currentCategory = await Category.findOne({
        categoryId: req.params.id,
      });
      if (!currentCategory) return true;

      const existing = await Category.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
        _id: { $ne: currentCategory._id },
      });
      if (existing) {
        throw new Error("Category name already exists");
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

  checkCategoryImageOnUpdate,
  handleValidation,
];

const validateCategoryId = [
  param("id").notEmpty().withMessage("Category ID is required in URL"),
  handleValidation,
];

const variationSchema = new mongoose.Schema({
  size: { type: String, required: true },
  color: { type: String, required: true },
  regularPrice: { type: Number, required: true, min: 0 },
  discountPrice: { type: Number, min: 0 },
  stock: { type: Number, required: true, min: 0 },
});

module.exports = {
  validateCreateCategory,
  validateUpdateCategory,
  validateCategoryId,
};
