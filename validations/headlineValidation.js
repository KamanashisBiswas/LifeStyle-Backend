/**
 * ============================================================
 * validations/headlineValidation.js — Headline Validation Rules
 * ============================================================
 * Homepage এর scrolling marquee headline (offerText) create ও
 * update করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - offerText: required, max 200 characters
 *  - status: "active" বা "inactive" হতে হবে
 *
 * Exported validators:
 *  - validateCreateHeadline → POST /api/headline
 *  - validateUpdateHeadline → PATCH /api/headline/:id
 * ============================================================
 */
// validation/headlineValidation.js
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

const validateCreateHeadline = [
  body("offerText")
    .trim()
    .notEmpty()
    .withMessage("Offer text is required")
    .isLength({ max: 200 })
    .withMessage("Offer text cannot exceed 200 characters"),
  body("status")
    .trim()
    .notEmpty()
    .withMessage("Status is required")
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  handleValidation,
];

const validateUpdateHeadline = [
  param("id").notEmpty().withMessage("Headline ID is required in URL"),
  body("offerText")
    .trim()
    .notEmpty()
    .withMessage("Offer text is required")
    .isLength({ max: 200 })
    .withMessage("Offer text cannot exceed 200 characters"),
  body("status")
    .trim()
    .notEmpty()
    .withMessage("Status is required")
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  handleValidation,
];

const validateHeadlineId = [
  param("id").notEmpty().withMessage("Headline ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateHeadline,
  validateUpdateHeadline,
  validateHeadlineId,
};
