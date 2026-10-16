/**
 * ============================================================
 * validations/carouselRightValidation.js — Right Carousel Validation
 * ============================================================
 * Homepage এর ডান পাশের small banner (carousel right) তৈরি ও
 * আপডেট করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - order: 1, 2, বা 3 এর মধ্যে unique হতে হবে (DB check)
 *  - update এ order পরিবর্তন করলে সে order অন্য দোকানের সাথে conflict
 *    না হতে হবে (নিজের id exclude করে check)
 *
 * Exported validators:
 *  - validateCreateCarouselRight → POST /api/carousel-right
 *  - validateUpdateCarouselRight → PATCH /api/carousel-right/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const CarouselRight = require("../models/CarouselRight"); // order unique check এর জন্য

const validateCreateCarouselRight = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 100 })
    .withMessage("Title must be at most 100 characters"),
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
  body("order")
    .notEmpty()
    .withMessage("Order is required")
    .isInt({ min: 1, max: 3 })
    .withMessage("Order must be between 1 and 3")
    .custom(async (value, { req }) => {
      const existing = await CarouselRight.findOne({ order: value });
      if (existing) {
        throw new Error(`Order ${value} is already taken`);
      }
      return true;
    }),
  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  (req, res, next) => {
    // Check for image presence
    if (!req.files || !req.files.image || !req.files.image[0]) {
      return res
        .status(400)
        .json({ success: false, message: "Image is required" });
    }
    next();
  },
  handleValidation,
];

const validateUpdateCarouselRight = [
  param("id").notEmpty().withMessage("Carousel Right ID is required in URL"),
  body("title")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Title must be at most 100 characters"),
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
  body("order")
    .optional()
    .isInt({ min: 1, max: 3 })
    .withMessage("Order must be between 1 and 3")
    .custom(async (value, { req }) => {
      if (value) {
        const existing = await CarouselRight.findOne({ order: value });
        if (existing && existing.carouselRightId !== req.params.id) {
          throw new Error(`Order ${value} is already taken`);
        }
      }
      return true;
    }),
  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be active or inactive"),
  handleValidation,
];

const validateCarouselRightId = [
  param("id").notEmpty().withMessage("Carousel Right ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateCarouselRight,
  validateUpdateCarouselRight,
  validateCarouselRightId,
};
