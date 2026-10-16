/**
 * ============================================================
 * validations/productValidation.js — Product Validation Rules
 * ============================================================
 * Product (পণ্য) তৈরি ও আপডেট করার সময় input validate করার
 * rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - checkProductFiles: bannerImage (exactly 1) + images (1‚äã5) mandatory
 *  - variations[]: size, colorId, stock, price প্রতিটি item এ থাকতে হবে
 *  - category, subCategory, brand: MongoDB ObjectId
 *  - variations JSON string হিসেবে parse করে validate করা হয়
 *
 * Exported validators:
 *  - checkProductFiles      → file presence middleware
 *  - validateCreateProduct  → POST /api/product
 *  - validateUpdateProduct  → PATCH /api/product/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

const validateCreateProduct = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required")
    .isLength({ max: 100 }),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ max: 2000 }),
  body("category")
    .trim()
    .notEmpty()
    .withMessage("Category is required")
    .isMongoId()
    .withMessage("Category must be a valid ID"),
  body("subCategory")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("SubCategory must be a valid ID");
      }
      return true;
    }),
  body("brand")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("Brand must be a valid ID");
      }
      return true;
    }),
  body("vendor")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("Vendor must be a valid ID");
      }
      return true;
    }),
  body("variation")
    .notEmpty()
    .withMessage("At least one variation is required")
    .custom((value) => {
      let variations = value;
      if (typeof value === "string") {
        variations = JSON.parse(value);
      }
      if (!Array.isArray(variations) || variations.length === 0) {
        throw new Error("At least one variation is required");
      }
      for (const v of variations) {
        if (typeof v.basePrice === "undefined" || v.basePrice === null) {
          throw new Error("Each variation must have a basePrice");
        }
        if (isNaN(Number(v.basePrice)) || Number(v.basePrice) < 0) {
          throw new Error("Each variation must have a valid basePrice >= 0");
        }
        if (
          typeof v.stock !== "undefined" &&
          v.stock !== null &&
          v.stock !== "" &&
          (isNaN(Number(v.stock)) || Number(v.stock) < 0)
        ) {
          throw new Error("Each variation stock must be a valid number >= 0");
        }
        if (
          typeof v.discountPrice !== "undefined" &&
          v.discountPrice !== null &&
          v.discountPrice !== "" &&
          (isNaN(Number(v.discountPrice)) || Number(v.discountPrice) < 0)
        ) {
          throw new Error(
            "Each variation must have a valid discountPrice >= 0",
          );
        }
      }
      return true;
    }),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),
  body("flag")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(["just-for-you", "flash-sale", "new-stock", "trendy", "top-selling", ""])
    .withMessage("Invalid product flag"),
  handleValidation,
];

const validateUpdateProduct = [
  param("id").notEmpty().withMessage("Product ID is required"),
  body("name").optional().trim().isLength({ max: 100 }),
  body("description").optional().trim().isLength({ max: 2000 }),
  body("category")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Category cannot be empty")
    .isMongoId()
    .withMessage("Category must be a valid ID"),
  body("subCategory")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("SubCategory must be a valid ID");
      }
      return true;
    }),
  body("brand")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("Brand must be a valid ID");
      }
      return true;
    }),
  body("vendor")
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || val === "null" || val === "none" || val === "undefined" || val === "") return true;
      if (!require("mongoose").Types.ObjectId.isValid(val)) {
        throw new Error("Vendor must be a valid ID");
      }
      return true;
    }),
  body("bannerImage").optional().isString(),
  body("images").optional().isArray(),
  body("regularPrice").optional().isFloat({ min: 0 }),
  body("discountPrice").optional().isFloat({ min: 0 }),
  body("variation")
    .optional()
    .custom((value) => {
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          if (!Array.isArray(parsed)) {
            throw new Error("Variation must be an array");
          }
          return true;
        } catch (err) {
          throw new Error("Variation must be a valid JSON array");
        }
      } else if (Array.isArray(value)) {
        return true;
      }
      throw new Error("Variation must be an array or JSON string");
    }),
  body("variation.*.size").optional(),
  body("variation.*.color").optional(),
  body("variation.*.price").optional().isFloat({ min: 0 }),
  body("variation.*.stock").optional().isInt({ min: 0 }),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),
  body("flag")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(["just-for-you", "flash-sale", "new-stock", "trendy", "top-selling", ""])
    .withMessage("Invalid product flag"),
  handleValidation,
];

const validateProductId = [
  param("id").notEmpty().withMessage("Product ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateProduct,
  validateUpdateProduct,
  validateProductId,
};
