/**
 * ============================================================
 * validations/authValidation.js — Admin/Employee Auth Validation
 * ============================================================
 * এই ফাইলে admin ও employee এর register, login এবং
 * refresh token request এর জন্য input validation rules আছে।
 *
 * express-validator এর body() দিয়ে request body validate করা হয়।
 * প্রতিটি validation array এর শেষে handleValidation middleware আছে
 * যেটি validation error থাকলে 400 response পাঠায়।
 *
 * Exported validators:
 *  - validateRegister     → POST /api/auth/register
 *  - validateLogin        → POST /api/auth/login
 *  - validateRefreshToken → POST /api/auth/refresh-token
 * ============================================================
 */
const { body } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

// Registration validation rules
const validateRegister = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Name can only contain letters and spaces"),

  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number",
    ),

  body("role")
    .optional()
    .isIn(["employee", "admin"])
    .withMessage("Role must be either employee or admin"),

  handleValidation,
];

// Login validation rules
const validateLogin = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  body("password").notEmpty().withMessage("Password is required"),

  handleValidation,
];

// Refresh token validation
const validateRefreshToken = [
  body("refreshToken").notEmpty().withMessage("Refresh token is required"),

  handleValidation,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateRefreshToken,
};
