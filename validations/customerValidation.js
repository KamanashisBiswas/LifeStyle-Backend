/**
 * ============================================================
 * validations/customerValidation.js — Customer Auth Validation
 * ============================================================
 * Website customer এর OTP registration, login, profile update
 * এবং password change এর জন্য input validate করার rules
 * এই ফাইলে আছে।
 *
 * OTP flow:
 *  1. POST /api/customer/send-otp   → validateSendOtp  (শুধু phone)
 *  2. POST /api/customer/verify-otp → validateVerifyOtp (phone + 4-digit OTP)
 *  3. POST /api/customer/register   → validateRegisterCustomer
 *
 * Exported validators:
 *  - validateSendOtp          → OTP পাঠানোর আগে phone validate
 *  - validateVerifyOtp        → phone ও 4-digit OTP validate
 *  - validateRegisterCustomer → registration form validate
 *  - validateLoginCustomer    → login (phone + password) validate
 *  - validateUpdateProfile    → profile update validate (optional fields)
 *  - validateChangePassword   → password change validate
 * ============================================================
 */
const { body } = require("express-validator");

const validateSendOtp = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone required")
    .isMobilePhone("any"),
];

const validateVerifyOtp = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone required")
    .isMobilePhone("any"),
  body("otp")
    .trim()
    .notEmpty()
    .withMessage("OTP required")
    .isLength({ min: 4, max: 4 })
    .withMessage("OTP must be 4 digits"),
];

const validateRegisterCustomer = [
  body("name").trim().notEmpty().withMessage("Name required"),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Provide a valid email"),
  body("phone").trim().notEmpty().isMobilePhone("any"),
  body("password")
    .optional({ checkFalsy: true })
    .isLength({ min: 6 })
    .withMessage("Password min 6 chars"),
  body("dob").optional({ checkFalsy: true }),
  body("otp").trim().notEmpty().withMessage("OTP required"),
];

const validateLoginCustomer = [
  body("phone").trim().notEmpty().isMobilePhone("any"),

  body("password").notEmpty().withMessage("Password required"),
];

const validateUpdateProfile = [
  body("name").optional().trim().notEmpty().withMessage("Name cannot be empty"),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Provide a valid email"),
  body("dob")
    .optional()
    .isISO8601()
    .toDate()
    .withMessage("Invalid date format"),
];

const validateChangePassword = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters long"),
];

module.exports = {
  validateSendOtp,
  validateVerifyOtp,
  validateRegisterCustomer,
  validateLoginCustomer,
  validateUpdateProfile,
  validateChangePassword,
};
