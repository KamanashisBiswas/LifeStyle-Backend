/**
 * ============================================================
 * validations/offerValidation.js — Offer Validation Rules
 * ============================================================
 * Express-validator schemas for offer CRUD and product attachments.
 */

const { body, param } = require("express-validator");

const validateCreateOffer = [
  body("title")
    .notEmpty()
    .withMessage("Offer title is required")
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Title cannot exceed 200 characters"),

  body("offerType")
    .notEmpty()
    .withMessage("offerType is required")
    .isIn(["flash-sale", "just-for-you"])
    .withMessage("offerType must be 'flash-sale' or 'just-for-you'"),

  body("discountType")
    .notEmpty()
    .withMessage("discountType is required")
    .isIn(["percentage", "fixed"])
    .withMessage("discountType must be 'percentage' or 'fixed'"),

  body("discountValue")
    .notEmpty()
    .withMessage("discountValue is required")
    .isFloat({ min: 0 })
    .withMessage("discountValue must be a number greater than or equal to 0")
    .custom((value, { req }) => {
      if (req.body.discountType === "percentage" && value > 100) {
        throw new Error("Percentage discount value cannot exceed 100%");
      }
      return true;
    }),

  body("priority")
    .optional()
    .isInt()
    .withMessage("priority must be an integer"),

  body("startDate")
    .notEmpty()
    .withMessage("startDate is required")
    .isISO8601()
    .withMessage("startDate must be a valid ISO date"),

  body("endDate")
    .notEmpty()
    .withMessage("endDate is required")
    .isISO8601()
    .withMessage("endDate must be a valid ISO date")
    .custom((value, { req }) => {
      if (req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("endDate must be after startDate");
      }
      return true;
    }),

  body("isActive")
    .optional()
    .isBoolean({ loose: true })
    .withMessage("isActive must be a boolean"),
];

const validateUpdateOffer = [
  param("id").isMongoId().withMessage("Invalid Offer ID"),

  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Title cannot exceed 200 characters"),

  body("offerType")
    .optional()
    .isIn(["flash-sale", "just-for-you"])
    .withMessage("offerType must be 'flash-sale' or 'just-for-you'"),

  body("discountType")
    .optional()
    .isIn(["percentage", "fixed"])
    .withMessage("discountType must be 'percentage' or 'fixed'"),

  body("discountValue")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("discountValue must be a number greater than or equal to 0")
    .custom((value, { req }) => {
      if (req.body.discountType === "percentage" && value > 100) {
        throw new Error("Percentage discount value cannot exceed 100%");
      }
      return true;
    }),

  body("priority")
    .optional()
    .isInt()
    .withMessage("priority must be an integer"),

  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("startDate must be a valid ISO date"),

  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("endDate must be a valid ISO date")
    .custom((value, { req }) => {
      if (req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("endDate must be after startDate");
      }
      return true;
    }),

  body("isActive")
    .optional()
    .isBoolean({ loose: true })
    .withMessage("isActive must be a boolean"),
];

const validateAddProducts = [
  param("id").isMongoId().withMessage("Invalid Offer ID"),

  body("productIds")
    .isArray({ min: 1 })
    .withMessage("productIds must be a non-empty array of product IDs"),

  body("productIds.*")
    .isMongoId()
    .withMessage("Each product ID must be a valid Mongo ObjectId"),
];

module.exports = {
  validateCreateOffer,
  validateUpdateOffer,
  validateAddProducts,
};
