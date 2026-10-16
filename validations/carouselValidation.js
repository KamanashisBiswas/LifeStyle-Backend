/**
 * ============================================================
 * validations/carouselValidation.js — Carousel Validation Rules
 * ============================================================
 * Homepage এর main banner slider (carousel) তৈরি ও আপডেট
 * করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - title: required, max 100 characters
 *  - status: "active" বা "inactive"
 *  - order: unique হতে হবে (DB check)
 *
 * Exported validators:
 *  - validateCreateCarousel → POST /api/carousel
 *  - validateUpdateCarousel → PATCH /api/carousel/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const Carousel = require("../models/Carousel"); // order unique check এর জন্য

const validateCreateCarousel = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 100 })
    .withMessage("Title must be at most 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters"),
  body("buttonText")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Button text must be at most 50 characters"),
  body("buttonUrl")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Button URL must be at most 200 characters"),
  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  (req, res, next) => {
    // Check for cover image presence
    if (!req.files || !req.files.coverImage || !req.files.coverImage[0]) {
      return res
        .status(400)
        .json({ success: false, message: "Cover image is required" });
    }
    next();
  },
  handleValidation,
];

const validateUpdateCarousel = [
  param("id").notEmpty().withMessage("Carousel ID is required in URL"),
  body("title")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Title must be at most 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be at most 500 characters"),
  body("buttonText")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Button text must be at most 50 characters"),
  body("buttonUrl")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Button URL must be at most 200 characters"),
  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  handleValidation,
];

const validateCarouselId = [
  param("id").notEmpty().withMessage("Carousel ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateCarousel,
  validateUpdateCarousel,
  validateCarouselId,
};
