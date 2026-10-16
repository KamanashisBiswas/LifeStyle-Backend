/**
 * ============================================================
 * routes/user.js — User Account Management Routes
 * ============================================================
 * Base path: /api/user
 *
 * Route সমূহ:
 *  GET    /api/user/profile           → authenticate, getProfile
 *  PUT    /api/user/profile           → authenticate, updateProfile
 *  PUT    /api/user/change-password   → authenticate, changePassword
 *  DELETE /api/user/account           → authenticate, deleteAccount (নিজের account)
 *  GET    /api/user/all               → authenticate + authorize(admin), getAllUsers
 *  GET    /api/user/:id               → authenticate + authorize(admin), getUserById
 *  PUT    /api/user/:id/role          → authenticate + authorize(admin), updateUserRole
 *  DELETE /api/user/:id               → authenticate + authorize(admin), deleteUser
 *  POST   /api/user/:id/profile-image → authenticate + profileUpload, uploadProfileImage
 *  DELETE /api/user/:id/profile-image → authenticate, deleteProfileImage
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

// Import controllers
const {
  updateProfile,
  changePassword,
  deleteAccount,
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  createUser,
  updateUserByAdmin,
  resetSalesmanRewardPoints,
  uploadProfileImage,
  deleteProfileImage,
  verifyUserDetails,
} = require("../controllers/userController");

// Import middleware
const { authenticate, authorize } = require("../middleware/auth");
const { profileUpload } = require("../config/cloudinary");

// Import validations
const {
  validateUpdateProfile,
  validateChangePassword,
  validateUserId,
  validateUpdateRole,
} = require("../validations/userValidation");

// @route   PUT /api/user/profile
// @desc    Update user profile
// @access  Private
publicRouter.put("/profile", authenticate, validateUpdateProfile, updateProfile);

// @route   PUT /api/user/change-password
// @desc    Change password
// @access  Private
publicRouter.put(
  "/change-password",
  authenticate,
  validateChangePassword,
  changePassword,
);

// @route   DELETE /api/user/account
// @desc    Delete user account
// @access  Private
publicRouter.delete("/account", authenticate, deleteAccount);

// @route   POST /api/user/upload-profile-image
// @desc    Upload profile image
// @access  Private
publicRouter.post(
  "/upload-profile-image",
  authenticate,
  profileUpload.single("profileImage"),
  uploadProfileImage,
);

// @route   DELETE /api/user/profile-image
// @desc    Delete profile image
// @access  Private
publicRouter.delete("/profile-image", authenticate, deleteProfileImage);

// Admin routes
// @route   GET /api/user/all
// @desc    Get all users
// @access  Private/Admin or users.view
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "users.view", "pos.sell", "orders.create"),
  getAllUsers,
);

// @route   GET /api/user/:id
// @desc    Get user by ID
// @access  Private/Admin or users.view
adminRouter.get(
  "/:id",
  authenticate,
  authorize("admin", "users.view"),
  validateUserId,
  getUserById,
);

// @route   PUT /api/user/:id/role
// @desc    Update user role
// @access  Private/Admin or users.edit
adminRouter.put(
  "/:id/role",
  authenticate,
  authorize("admin", "users.edit", "users.manage", "roles.manage"),
  validateUpdateRole,
  updateUserRole,
);

// @route   POST /api/admin/user
// @desc    Create new system user
// @access  Private/Admin or users.create
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "users.create", "users.manage"),
  profileUpload.single("avatar"),
  createUser,
);

// @route   PUT /api/admin/user/:id
// @desc    Update system user by Admin
// @access  Private/Admin or users.edit
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "users.edit", "users.manage"),
  validateUserId,
  profileUpload.single("avatar"),
  updateUserByAdmin,
);

// @route   POST /api/admin/user/:id/reset-points
// @desc    Redeem & Reset salesman reward points
// @access  Private/Admin or users.edit
adminRouter.post(
  "/:id/reset-points",
  authenticate,
  authorize("admin", "users.edit", "users.manage"),
  validateUserId,
  resetSalesmanRewardPoints,
);

// @route   PUT /api/admin/user/:id/verify
// @desc    Verify or Unverify user identification details
// @access  Private/Admin or users.edit
adminRouter.put(
  "/:id/verify",
  authenticate,
  authorize("admin", "users.edit", "users.manage"),
  validateUserId,
  verifyUserDetails,
);

// @route   DELETE /api/user/:id
// @desc    Delete user
// @access  Private/Admin or users.delete
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "users.delete", "users.manage"),
  validateUserId,
  deleteUser,
);

module.exports = { publicRouter, adminRouter };
