/**
 * ============================================================
 * routes/auth.js — Admin/Employee Authentication Routes
 * ============================================================
 * Base path: /api/auth
 *
 * Route সমূহ:
 *  POST /api/auth/register  → validateRegister middleware, register controller
 *  POST /api/auth/login     → validateLogin middleware, login controller
 *  POST /api/auth/refresh   → validateRefreshToken, refreshToken controller
 *  POST /api/auth/logout    → authenticate middleware, logout controller
 *  GET  /api/auth/me        → authenticate middleware, getMe controller
 *
 * Auth flow:
 *  Public routes: register, login, refresh
 *  Private routes: logout, me (authenticate middleware দরকার)
 * ============================================================
 */

const express = require("express");
const router = express.Router();

// Import controllers
const {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  sendStaffForgotPasswordOtp,
  verifyStaffForgotPasswordOtp,
  resetStaffPassword,
} = require("../controllers/authController");

// Import middleware
const { authenticate } = require("../middleware/auth");

// Import validations
const {
  validateRegister,
  validateLogin,
  validateRefreshToken,
} = require("../validations/authValidation");

// @route   POST /api/auth/register
// @desc    Register new user
// @access  Public
router.post("/register", validateRegister, register);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post("/login", validateLogin, login);

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post("/refresh", validateRefreshToken, refreshToken);

// @route   POST /api/auth/forgot-password/send-otp
// @desc    Send OTP to user's registered phone number for password reset
// @access  Public
router.post("/forgot-password/send-otp", sendStaffForgotPasswordOtp);

// @route   POST /api/auth/forgot-password/verify-otp
// @desc    Verify OTP for password reset
// @access  Public
router.post("/forgot-password/verify-otp", verifyStaffForgotPasswordOtp);

// @route   POST /api/auth/forgot-password/reset
// @desc    Reset password after phone OTP verification
// @access  Public
router.post("/forgot-password/reset", resetStaffPassword);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post("/logout", authenticate, logout);

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", authenticate, getMe);

module.exports = router;
