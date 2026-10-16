/**
 * ============================================================
 * routes/review.js — Product Review Routes
 * ============================================================
 * Public & Customer base path: /api/review
 * Admin base path:            /api/admin/review
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  checkEligibility,
  createOrUpdateReview,
  addCustomerReply,
  getProductReviews,
  toggleHelpful,
  getAllReviewsAdmin,
  updateReviewStatus,
  replyReview,
  editReviewAdmin,
  deleteReviewAdmin,
} = require("../controllers/reviewController");

const {
  authenticate,
  authenticateCustomer,
  authorize,
  optionalAuth,
} = require("../middleware/auth");

// ─── Public & Customer Routes (/api/review) ──────────────────

// @route   GET /api/review/product/:productId
// @desc    Get all approved reviews for a product
// @access  Public
publicRouter.get("/product/:productId", getProductReviews);

// @route   GET /api/review/check-eligibility/:productId
// @desc    Check if logged-in customer has a delivered order for this product
// @access  Private (Customer)
publicRouter.get(
  "/check-eligibility/:productId",
  authenticateCustomer,
  checkEligibility
);

// @route   POST /api/review
// @desc    Submit or update review (strictly verified delivered orders only)
// @access  Private (Customer)
publicRouter.post("/", authenticateCustomer, createOrUpdateReview);

// @route   POST /api/review/:reviewId/reply
// @desc    Customer reply to conversation thread
// @access  Private (Customer)
publicRouter.post("/:reviewId/reply", authenticateCustomer, addCustomerReply);

// @route   PUT /api/review/:reviewId/helpful
// @desc    Vote helpful on a review
// @access  Public / Customer
publicRouter.put("/:reviewId/helpful", optionalAuth, toggleHelpful);

// ─── Admin Routes (/api/admin/review) ────────────────────────

// @route   GET /api/admin/review
// @desc    Get all reviews with filters (pending, approved, rejected)
// @access  Private (Admin, Employee, reviews.view)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "reviews.view"),
  getAllReviewsAdmin
);

// @route   PUT /api/admin/review/:reviewId/status
// @desc    Approve or reject review
// @access  Private (Admin, Employee, reviews.approve)
adminRouter.put(
  "/:reviewId/status",
  authenticate,
  authorize("admin", "employee", "reviews.approve"),
  updateReviewStatus
);

// @route   POST /api/admin/review/:reviewId/reply
// @desc    Reply to a review (shown on product page)
// @access  Private (Admin, Employee, reviews.approve)
adminRouter.post(
  "/:reviewId/reply",
  authenticate,
  authorize("admin", "employee", "reviews.approve"),
  replyReview
);

// @route   PUT /api/admin/review/:reviewId
// @desc    Edit review rating/comment
// @access  Private (Admin, reviews.approve)
adminRouter.put(
  "/:reviewId",
  authenticate,
  authorize("admin", "reviews.approve"),
  editReviewAdmin
);

// @route   DELETE /api/admin/review/:reviewId
// @desc    Delete review
// @access  Private (Admin, reviews.delete)
adminRouter.delete(
  "/:reviewId",
  authenticate,
  authorize("admin", "reviews.delete"),
  deleteReviewAdmin
);

module.exports = { publicRouter, adminRouter };
