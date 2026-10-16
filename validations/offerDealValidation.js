/**
 * ============================================================
 * validations/offerDealValidation.js — Offer Deal Validation
 * ============================================================
 * Special offer / deal (বিশেষ অফার) তৈরি ও আপডেট
 * করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - type: "Product" বা "Shipping" হতে হবে
 *  - checkOfferDealImage: image 5MB এর মধ্যে হতে হবে
 *  - startTime ও endTime: optional ISO 8601 format
 *  - discountType: "Percentage" বা "Flat" (optional)
 *
 * Exported validators:
 *  - checkOfferDealImage    → file size check middleware
 *  - validateCreateOfferDeal → POST /api/offer-deals
 *  - validateUpdateOfferDeal → PATCH /api/offer-deals/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

// Custom middleware to check file
const checkOfferDealImage = (req, res, next) => {
  if (req.file && req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: [{ field: "image", message: "Image size must be less than 5MB" }],
    });
  }
  next();
};

const validateCreateOfferDeal = [
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
    .isIn(["Product", "Shipping"])
    .withMessage("Type must be either Product or Shipping"),
  body("regularPrice")
    .notEmpty()
    .withMessage("Regular price is required")
    .isFloat({ min: 0 })
    .withMessage("Regular price must be a positive number"),
  body("offerPrice")
    .notEmpty()
    .withMessage("Offer price is required")
    .isFloat({ min: 0 })
    .withMessage("Offer price must be a positive number"),
  body("discountPercentage")
    .notEmpty()
    .withMessage("Discount percentage is required")
    .isFloat({ min: 0, max: 100 })
    .withMessage("Discount percentage must be between 0 and 100"),
  body("startTime")
    .notEmpty()
    .withMessage("Start time is required")
    .isISO8601()
    .withMessage("Start time must be a valid date"),
  body("endTime")
    .notEmpty()
    .withMessage("End time is required")
    .isISO8601()
    .withMessage("End time must be a valid date")
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startTime)) {
        throw new Error("End time must be after start time");
      }
      return true;
    }),
  body("isActive").isBoolean().withMessage("isActive must be a boolean value"),
  checkOfferDealImage,
  handleValidation,
];

const validateUpdateOfferDeal = [
  param("id").notEmpty().withMessage("Offer deal ID is required"),
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
    .isIn(["Product", "Shipping"])
    .withMessage("Type must be either Product or Shipping"),
  body("regularPrice")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Regular price must be a positive number"),
  body("offerPrice")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Offer price must be a positive number"),
  body("discountPercentage")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("Discount percentage must be between 0 and 100"),
  body("startTime")
    .optional()
    .isISO8601()
    .withMessage("Start time must be a valid date"),
  body("endTime")
    .optional()
    .isISO8601()
    .withMessage("End time must be a valid date")
    .custom((value, { req }) => {
      if (
        value &&
        req.body.startTime &&
        new Date(value) <= new Date(req.body.startTime)
      ) {
        throw new Error("End time must be after start time");
      }
      return true;
    }),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value"),
  checkOfferDealImage,
  handleValidation,
];

const validateOfferDealId = [
  param("id").notEmpty().withMessage("Offer deal ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateOfferDeal,
  validateUpdateOfferDeal,
  validateOfferDealId,
};
