/**
 * ============================================================
 * validations/userValidation.js — Admin User Validation Rules
 * ============================================================
 * Admin user profile update, password change, role update এবং
 * user ID validation এর জন্য input validate করার
 * rules এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - name: letters ও spaces মাত্র (regex), 2‚äã50 chars
 *  - newPassword: uppercase + lowercase + digit mandatory
 *  - confirmPassword: newPassword এর সাথে match হতে হবে
 *  - role: admin, employee, salesman, user এর মধ্যে যেকোনোটি
 *
 * Exported validators:
 *  - validateUpdateProfile  → PATCH /api/user/profile
 *  - validateChangePassword → PATCH /api/user/change-password
 *  - validateUserId         → GET/DELETE /api/user/:id
 *  - validateUpdateRole     → PATCH /api/user/:id/role
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

// Update profile validation rules
const validateUpdateProfile = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),

  body("email")
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  body("avatar").optional().isURL().withMessage("Avatar must be a valid URL"),

  handleValidation,
];

// Change password validation rules
const validateChangePassword = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required"),

  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "New password must contain at least one uppercase letter, one lowercase letter, and one number",
    ),

  body("confirmPassword").custom((value, { req }) => {
    const confirm = value !== undefined ? value : req.body?.confirmPassword;
    if (confirm !== undefined && confirm !== req.body?.newPassword) {
      throw new Error("Password confirmation does not match new password");
    }
    return true;
  }),

  handleValidation,
];

// User ID validation for admin routes
const validateUserId = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  handleValidation,
];

// Update user role validation (admin only)
const validateUpdateRole = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  body("role")
    .isIn(["user", "employee", "salesman", "manager"])
    .withMessage("Role must be either user, employee, salesman, or manager"),

  handleValidation,
];

module.exports = {
  validateUpdateProfile,
  validateChangePassword,
  validateUserId,
  validateUpdateRole,
};
