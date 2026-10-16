/**
 * ============================================================
 * validations/headerValidation.js — Header Validation Rules
 * ============================================================
 * Website এর header section (offerText + companyName) create ও
 * update করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - offerText: required, max 200 characters
 *  - companyName: required, max 100 characters
 *  - header একটিমাত্র record থাকে, তাই create বা update
 *    দুটোতেই same fields validate হয়
 *
 * Exported validators:
 *  - validateCreateHeader → POST /api/header
 *  - validateUpdateHeader → PATCH /api/header/:id
 * ============================================================
 */
const { body } = require("express-validator");
const { handleValidation } = require("../middleware/validation"); // handleValidation — validation error check করে 400 response পাঠায়

const validateCreateHeader = [
  body("offerText")
    .trim()
    .notEmpty()
    .withMessage("Offer text is required")
    .isLength({ max: 200 })
    .withMessage("Offer text cannot exceed 200 characters"),
  body("companyName")
    .trim()
    .notEmpty()
    .withMessage("Company name is required")
    .isLength({ max: 100 })
    .withMessage("Company name cannot exceed 100 characters"),
  handleValidation, // <-- এই লাইনের জন্য route ফাইলে ... ব্যবহার করতে হবে না
];

const validateUpdateHeader = [
  body("offerText")
    .trim()
    .notEmpty()
    .withMessage("Offer text is required")
    .isLength({ max: 200 })
    .withMessage("Offer text cannot exceed 200 characters"),
  body("companyName")
    .trim()
    .notEmpty()
    .withMessage("Company name is required")
    .isLength({ max: 100 })
    .withMessage("Company name cannot exceed 100 characters"),
  handleValidation,
];

module.exports = {
  validateCreateHeader,
  validateUpdateHeader,
};
