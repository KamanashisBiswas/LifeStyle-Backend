/**
 * ============================================================
 * validations/subCategoryValidation.js — Sub-Category Validation
 * ============================================================
 * Product sub-category (পণ্য উপ-বিভাগ) তৈরি ও আপডেট করার সময়
 * input validate করার জন্য এই ফাইলের rules ব্যবহার করা হয়।
 *
 * বিশেষ নিয়ম:
 *  - sub-category name same categoryতে unique হতে হবে
 *    (category id + name দিয়ে DB check)
 *  - category field: valid MongoDB ObjectId হতে হবে
 *
 * Exported validators:
 *  - validateCreateSubCategory → POST /api/subcategory
 *  - validateUpdateSubCategory → PATCH /api/subcategory/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const SubCategory = require("../models/SubCategory"); // duplicate name per-category check এর জন্য

const validateCreateSubCategory = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Sub category name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Sub category name must be between 3 and 50 characters")
    .custom(async (value, { req }) => {
      const existing = await SubCategory.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
        category: req.body.category,
      });
      if (existing) {
        throw new Error("Sub category name already exists in this category");
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("category")
    .notEmpty()
    .withMessage("Category ID is required")
    .isMongoId()
    .withMessage("Invalid category ID format"),

  body("isActive")
    .exists()
    .withMessage("isActive status is required")
    .toBoolean()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),

  handleValidation,
];

const validateUpdateSubCategory = [
  param("id").notEmpty().withMessage("Sub category ID is required in URL"),

  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage("Sub category name must be between 3 and 50 characters")
    .custom(async (value, { req }) => {
      if (!value) return true;
      // Find the current subcategory by subCategoryId (custom id)
      let current = await SubCategory.findOne({ subCategoryId: req.params.id });
      if (!current && req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
        current = await SubCategory.findById(req.params.id);
      }
      if (!current) return true;

      const categoryId = req.body.category || current.category;
      const existing = await SubCategory.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
        category: categoryId,
        _id: { $ne: current._id },
      });
      if (existing) {
        throw new Error("Sub category name already exists in this category");
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("category")
    .optional()
    .isMongoId()
    .withMessage("Invalid category ID format"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),

  handleValidation,
];

const validateSubCategoryId = [
  param("id").notEmpty().withMessage("Sub category ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateSubCategory,
  validateUpdateSubCategory,
  validateSubCategoryId,
};
