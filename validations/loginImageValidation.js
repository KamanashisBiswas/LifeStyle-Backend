/**
 * ============================================================
 * validations/loginImageValidation.js — Login Image Validation
 * ============================================================
 * Admin login page এর logo, image ও background image আপলোড
 * করার সময় input validate করার rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - checkLoginImage: create-এ logo, image, bgImage তিনটি
 *    required — যেকোনো মিস্যাত্দ field থাকলে Cloudinaryতে
 *    upload হয়া ফাইলগুলো স্বয়ংক্রিয়ভাবে ডিলিট হার cleanup করতে পারে
 *  - checkUpdateLoginImage: update-এ শুধু পাঠানো file বা field validate
 *
 * Exported validators:
 *  - checkLoginImage        → file presence (create)
 *  - checkUpdateLoginImage  → file presence (update)
 *  - validateLoginImageData → POST /api/login-image
 * ============================================================
 */
// validations/loginImageValidation.js
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");
const LoginImage = require("../models/LoginImage");
const {
  deleteImageFromCloudinary,
  extractPublicIdFromUrl,
} = require("../config/cloudinary");

// This middleware is specifically for the CREATE route. It checks if all files are present.
const checkLoginImage = async (req, res, next) => {
  const missingFields = [];
  if (!req.files || !req.files.logo || !req.files.logo[0]) {
    missingFields.push({ field: "logo", message: "Logo is required" });
  }
  if (!req.files || !req.files.image || !req.files.image[0]) {
    missingFields.push({ field: "image", message: "Login image is required" });
  }
  if (!req.files || !req.files.bgImage || !req.files.bgImage[0]) {
    missingFields.push({
      field: "bgImage",
      message: "Background image is required",
    });
  }
  if (missingFields.length > 0) {
    // Delete any uploaded images from Cloudinary before sending response
    ["logo", "image", "bgImage"].forEach((field) => {
      if (req.files && req.files[field] && req.files[field][0]) {
        const url = req.files[field][0].path;
        const publicId = extractPublicIdFromUrl(url);
        if (publicId) {
          deleteImageFromCloudinary(publicId);
        }
      }
    });

    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: missingFields,
    });
  }
  next();
};

const validateCreateLoginImage = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Login image name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Login image name must be between 3 and 50 characters")
    .custom(async (value) => {
      const existing = await LoginImage.findOne({
        name: { $regex: `^${value}$`, $options: "i" },
      });
      if (existing) {
        throw new Error("Login image name already exists");
      }
      return true;
    }),
  checkLoginImage,
  handleValidation,
];

const validateUpdateLoginImage = [
  param("id").notEmpty().withMessage("Login image ID is required in URL"),
  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage("Login image name must be between 3 and 50 characters"),
  handleValidation,
];

const validateLoginImageId = [
  param("id").notEmpty().withMessage("Login image ID is required in URL"),
  handleValidation,
];

module.exports = {
  validateCreateLoginImage,
  validateUpdateLoginImage,
  validateLoginImageId,
};
