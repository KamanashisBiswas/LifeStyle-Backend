/**
 * ============================================================
 * controllers/reviewController.js — Product Review Controller
 * ============================================================
 * কাস্টমারদের রিভিউ চেক, সাবমিশন, অ্যাপ্রুভাল এবং অ্যাডমিন রিপ্লাই হ্যান্ডেল করে।
 * ============================================================
 */

const mongoose = require("mongoose");
const Review = require("../models/Review");
const Product = require("../models/Product");
const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Helper: Find product by ObjectId or slug / productId code
 */
const resolveProduct = async (productIdentifier) => {
  if (!productIdentifier) return null;

  // If passed an object instead of string ID (e.g. { _id: ... })
  if (typeof productIdentifier === "object") {
    if (productIdentifier._id) {
      return resolveProduct(productIdentifier._id);
    }
    if (productIdentifier.id) {
      return resolveProduct(productIdentifier.id);
    }
    if (productIdentifier.productId) {
      return resolveProduct(productIdentifier.productId);
    }
  }

  const cleanId = String(productIdentifier).trim();
  if (
    !cleanId ||
    cleanId === "undefined" ||
    cleanId === "null" ||
    cleanId === "[object Object]"
  ) {
    return null;
  }

  // 1. Try finding by MongoDB ObjectId
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    const product = await Product.findById(cleanId);
    if (product) return product;
  }

  // 2. Try finding by custom productId or slug
  const productByCodeOrSlug = await Product.findOne({
    $or: [{ productId: cleanId }, { slug: cleanId }],
  });
  if (productByCodeOrSlug) return productByCodeOrSlug;

  // 3. Fallback: try finding by product name
  return await Product.findOne({
    name: {
      $regex: new RegExp(
        `^${cleanId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    },
  });
};

/**
 * Helper: Recalculate average rating & review count for a product
 * (Only counts approved reviews)
 */
const recalculateProductRating = async (productId) => {
  try {
    const objectId = new mongoose.Types.ObjectId(productId);
    const stats = await Review.aggregate([
      {
        $match: {
          product: objectId,
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$product",
          avgRating: { $avg: "$rating" },
          numReviews: { $sum: 1 },
        },
      },
    ]);

    const rating = stats.length > 0 ? Number(stats[0].avgRating.toFixed(1)) : 0;
    const reviewCount = stats.length > 0 ? stats[0].numReviews : 0;

    await Product.findByIdAndUpdate(objectId, {
      rating,
      reviewCount,
    });

    return { rating, reviewCount };
  } catch (error) {
    console.error("Error recalculating product rating:", error);
  }
};

/**
 * @desc    Check if logged in customer can review this product (Delivered order required)
 * @route   GET /api/review/check-eligibility/:productId
 * @access  Private (Customer)
 */
exports.checkEligibility = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await resolveProduct(productId);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  const activeCustomer = req.customer || req.user;
  if (!activeCustomer) {
    return res.status(401).json({
      success: false,
      canReview: false,
      hasPurchased: false,
      message: "Customer authentication required.",
    });
  }

  const customerId = activeCustomer._id;
  const customerPhone = activeCustomer.phone ? String(activeCustomer.phone).trim() : null;

  // Build customer query clauses safely (support ObjectId & String)
  const customerConditions = [];
  if (customerId) {
    customerConditions.push({ customer: customerId });
    customerConditions.push({ customer: String(customerId) });
  }
  if (customerPhone) {
    const rawPhone = customerPhone.replace(/^(\+88|88)/, "");
    customerConditions.push({ phone: customerPhone });
    customerConditions.push({ phone: rawPhone });
    customerConditions.push({ phone: `+88${rawPhone}` });
    customerConditions.push({ phone: `88${rawPhone}` });
  }

  // Build product query clauses (matches ObjectId, String, or custom code)
  const productConditions = [
    { "products.productId": product._id },
    { "products.productId": String(product._id) },
  ];
  if (product.productId) {
    productConditions.push({ "products.productIdCode": product.productId });
  }
  if (product.name) {
    productConditions.push({ "products.name": product.name });
  }

  // 1. Check if customer placed ANY order containing this specific product (Native driver matches both BSON String & ObjectId)
  const anyOrder = await Order.collection.findOne(
    {
      $and: [
        { $or: customerConditions },
        { $or: productConditions },
      ],
    },
    { sort: { createdAt: -1 } }
  );

  // 2. Check if customer has a DELIVERED order containing this specific product
  const deliveredOrder = await Order.collection.findOne({
    $and: [
      { $or: customerConditions },
      { status: { $regex: /^delivered$/i } },
      { $or: productConditions },
    ],
  });

  // 3. Check if customer already submitted a review
  const existingReview = await Review.findOne({
    product: product._id,
    customer: customerId,
  });

  return res.status(200).json({
    success: true,
    canReview: Boolean(deliveredOrder),
    hasPurchased: Boolean(anyOrder),
    orderStatus: anyOrder ? anyOrder.status : null,
    hasReviewed: Boolean(existingReview),
    existingReview: existingReview || null,
    orderId: deliveredOrder?.orderId || anyOrder?.orderId || null,
    productId: product._id,
  });
});

/**
 * @desc    Create or update review for a product (strictly verified delivered buyers only)
 * @route   POST /api/review
 * @access  Private (Customer)
 */
exports.createOrUpdateReview = asyncHandler(async (req, res) => {
  const { productId, rating, title, comment, images } = req.body;

  if (!productId || !rating || !comment) {
    return res.status(400).json({
      success: false,
      message: "Product, rating (1-5), and comment are required.",
    });
  }

  const numRating = Number(rating);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({
      success: false,
      message: "Rating must be a number between 1 and 5.",
    });
  }

  const product = await resolveProduct(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  const activeCustomer = req.customer || req.user;
  if (!activeCustomer) {
    return res.status(401).json({
      success: false,
      message: "Authentication required to submit review.",
    });
  }

  const customerId = activeCustomer._id;
  const customerPhone = activeCustomer.phone ? String(activeCustomer.phone).trim() : null;
  const customerName = activeCustomer.name || "Valued Customer";

  // Build customer query clauses safely (support ObjectId & String)
  const customerConditions = [];
  if (customerId) {
    customerConditions.push({ customer: customerId });
    customerConditions.push({ customer: String(customerId) });
  }
  if (customerPhone) {
    const rawPhone = customerPhone.replace(/^(\+88|88)/, "");
    customerConditions.push({ phone: customerPhone });
    customerConditions.push({ phone: rawPhone });
    customerConditions.push({ phone: `+88${rawPhone}` });
    customerConditions.push({ phone: `88${rawPhone}` });
  }

  // Build product query clauses (matches ObjectId, String, or custom code)
  const productConditions = [
    { "products.productId": product._id },
    { "products.productId": String(product._id) },
  ];
  if (product.productId) {
    productConditions.push({ "products.productIdCode": product.productId });
  }
  if (product.name) {
    productConditions.push({ "products.name": product.name });
  }

  // 1. Strict Verification: Did this customer purchase this specific product?
  const anyOrder = await Order.collection.findOne(
    {
      $and: [
        { $or: customerConditions },
        { $or: productConditions },
      ],
    },
    { sort: { createdAt: -1 } }
  );

  if (!anyOrder) {
    return res.status(403).json({
      success: false,
      message: "আপনি এই পণ্যটি ক্রয় করেননি। শুধুমাত্র ক্রয়কৃত পণ্যের রিভিউ দেওয়া যাবে।",
    });
  }

  // 2. Strict Verification: Was this order DELIVERED?
  const deliveredOrder = await Order.collection.findOne({
    $and: [
      { $or: customerConditions },
      { status: { $regex: /^delivered$/i } },
      { $or: productConditions },
    ],
  });

  if (!deliveredOrder) {
    const statusText = anyOrder.status ? anyOrder.status.toUpperCase() : "PROCESSING";
    return res.status(403).json({
      success: false,
      message: `আপনার অর্ডারটির বর্তমান অবস্থা '${statusText}'। পণ্যটি ডেলিভারি (Delivered) হওয়ার পরেই কেবল রিভিউ দেওয়া যাবে।`,
    });
  }

  // Check if review already exists
  let review = await Review.findOne({
    product: product._id,
    customer: customerId,
  });

  if (review) {
    // Update existing review -> revert to pending for admin re-approval
    review.rating = numRating;
    review.title = title || "";
    review.comment = comment.trim();
    if (Array.isArray(images)) review.images = images;
    review.customerName = customerName;
    review.status = "pending"; // Pending admin approval
    await review.save();

    // Recalculate rating in case it was previously approved
    await recalculateProductRating(product._id);

    return res.status(200).json({
      success: true,
      message: "আপনার রিভিউটি আপডেট হয়েছে এবং অ্যাডমিন অনুমোদনের জন্য জমা দেওয়া হয়েছে।",
      data: review,
    });
  }

  // Create new review
  review = await Review.create({
    product: product._id,
    customer: customerId,
    customerName,
    customerPhone: customerPhone || "",
    order: deliveredOrder._id,
    rating: numRating,
    title: title || "",
    comment: comment.trim(),
    images: Array.isArray(images) ? images : [],
    isVerifiedPurchase: true,
    status: "pending", // Waiting for admin approval
  });

  return res.status(201).json({
    success: true,
    message:
      "Thank you! Your review has been submitted and will appear once approved by admin.",
    data: review,
  });
});

/**
 * @desc    Get all approved reviews for a product (with distribution & stats)
 * @route   GET /api/review/product/:productId
 * @access  Public
 */
exports.getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { sort = "newest", page = 1, limit = 10 } = req.query;

  const product = await resolveProduct(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found.",
    });
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  // Sort criteria
  let sortOption = { createdAt: -1 };
  if (sort === "highest") sortOption = { rating: -1, createdAt: -1 };
  if (sort === "lowest") sortOption = { rating: 1, createdAt: -1 };
  if (sort === "helpful") sortOption = { helpfulCount: -1, createdAt: -1 };

  // Only approved reviews for public
  const query = { product: product._id, status: "approved" };

  const [reviews, totalReviews, ratingStats] = await Promise.all([
    Review.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Review.countDocuments(query),
    Review.aggregate([
      { $match: { product: product._id, status: "approved" } },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Calculate breakdown percentages for 1 to 5 stars
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sumRating = 0;

  ratingStats.forEach((stat) => {
    const star = stat._id;
    if (breakdown[star] !== undefined) {
      breakdown[star] = stat.count;
      sumRating += star * stat.count;
    }
  });

  const averageRating =
    totalReviews > 0 ? Number((sumRating / totalReviews).toFixed(1)) : 0;

  const ratingPercentages = {
    5: totalReviews > 0 ? Math.round((breakdown[5] / totalReviews) * 100) : 0,
    4: totalReviews > 0 ? Math.round((breakdown[4] / totalReviews) * 100) : 0,
    3: totalReviews > 0 ? Math.round((breakdown[3] / totalReviews) * 100) : 0,
    2: totalReviews > 0 ? Math.round((breakdown[2] / totalReviews) * 100) : 0,
    1: totalReviews > 0 ? Math.round((breakdown[1] / totalReviews) * 100) : 0,
  };

  return res.status(200).json({
    success: true,
    data: {
      reviews,
      totalReviews,
      averageRating,
      ratingPercentages,
      ratingCounts: breakdown,
      currentPage: pageNum,
      totalPages: Math.ceil(totalReviews / limitNum) || 1,
    },
  });
});

/**
 * @desc    Toggle helpful vote on a review
 * @route   PUT /api/review/:reviewId/helpful
 * @access  Private (Customer) or Public
 */
exports.toggleHelpful = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const review = await Review.findById(reviewId);

  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  const userId = req.customer?._id || req.user?._id;

  if (userId) {
    const hasLiked = review.helpfulUsers.some(
      (id) => id.toString() === userId.toString()
    );

    if (hasLiked) {
      review.helpfulUsers = review.helpfulUsers.filter(
        (id) => id.toString() !== userId.toString()
      );
      review.helpfulCount = Math.max(0, review.helpfulCount - 1);
    } else {
      review.helpfulUsers.push(userId);
      review.helpfulCount += 1;
    }
  } else {
    // Guest simple counter increment
    review.helpfulCount += 1;
  }

  await review.save();

  return res.status(200).json({
    success: true,
    helpfulCount: review.helpfulCount,
  });
});

// ============================================================
// ADMIN CONTROLLERS
// ============================================================

/**
 * @desc    Admin: Get all reviews (with status, product filters & pagination)
 * @route   GET /api/admin/review
 * @access  Private (Admin)
 */
exports.getAllReviewsAdmin = asyncHandler(async (req, res) => {
  const { status, productId, page = 1, limit = 20, search = "" } = req.query;

  const query = {};
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    query.status = status;
  }

  if (productId && mongoose.Types.ObjectId.isValid(productId)) {
    query.product = productId;
  }

  if (search.trim()) {
    query.$or = [
      { customerName: { $regex: search, $options: "i" } },
      { comment: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [reviews, total, pendingCount, approvedCount, rejectedCount] =
    await Promise.all([
      Review.find(query)
        .populate("product", "name bannerImage images productId")
        .populate("customer", "name phone email")
        .populate("order", "orderId status createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(query),
      Review.countDocuments({ status: "pending" }),
      Review.countDocuments({ status: "approved" }),
      Review.countDocuments({ status: "rejected" }),
    ]);

    const stats = {
      total: pendingCount + approvedCount + rejectedCount,
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
    };

    return res.status(200).json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        limit: limitNum,
      },
      stats,
    });
  });

/**
 * @desc    Admin: Update review status (Approve / Reject)
 * @route   PUT /api/admin/review/:reviewId/status
 * @access  Private (Admin)
 */
exports.updateReviewStatus = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { status } = req.body;

  if (!["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be 'pending', 'approved', or 'rejected'.",
    });
  }

  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  review.status = status;
  await review.save();

  // Recalculate product rating
  const stats = await recalculateProductRating(review.product);

  return res.status(200).json({
    success: true,
    message: `Review has been ${status}.`,
    data: review,
    productStats: stats,
  });
});

/**
 * @desc    Admin: Reply to a review
 * @route   POST /api/admin/review/:reviewId/reply
 * @access  Private (Admin)
 */
exports.replyReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { comment, adminName } = req.body;

  if (!comment || !comment.trim()) {
    return res.status(400).json({
      success: false,
      message: "Reply comment is required.",
    });
  }

  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  const adminDisplayName = adminName?.trim() || req.user?.name || "Lifestyle Team";
  review.adminReply = {
    comment: comment.trim(),
    repliedAt: new Date(),
    adminName: adminDisplayName,
  };

  if (!Array.isArray(review.replies)) {
    review.replies = [];
  }
  review.replies.push({
    sender: "admin",
    senderName: adminDisplayName,
    message: comment.trim(),
    createdAt: new Date(),
  });

  await review.save();

  return res.status(200).json({
    success: true,
    message: "Admin reply added successfully.",
    data: review,
  });
});

/**
 * @desc    Customer: Reply to conversation thread on their review
 * @route   POST /api/review/:reviewId/reply
 * @access  Private (Customer)
 */
exports.addCustomerReply = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: "Message cannot be empty.",
    });
  }

  const activeCustomer = req.customer || req.user;
  if (!activeCustomer) {
    return res.status(401).json({
      success: false,
      message: "Customer authentication required.",
    });
  }

  let review = null;
  if (mongoose.Types.ObjectId.isValid(reviewId)) {
    review = await Review.findById(reviewId);
  }
  if (!review) {
    review = await Review.findOne({
      product: reviewId,
      customer: activeCustomer._id,
    });
  }

  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  // Ensure caller is the owner
  if (String(review.customer) !== String(activeCustomer._id)) {
    return res.status(403).json({
      success: false,
      message: "You can only reply to your own review.",
    });
  }

  if (!Array.isArray(review.replies)) {
    review.replies = [];
  }

  const replyObj = {
    sender: "customer",
    senderName: activeCustomer.name || review.customerName || "Customer",
    message: message.trim(),
    createdAt: new Date(),
  };

  review.replies.push(replyObj);
  await review.save();

  return res.status(200).json({
    success: true,
    message: "Reply sent successfully.",
    data: review,
  });
});

/**
 * @desc    Admin: Edit review details
 * @route   PUT /api/admin/review/:reviewId
 * @access  Private (Admin)
 */
exports.editReviewAdmin = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { rating, title, comment, status } = req.body;

  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  if (rating !== undefined) review.rating = Number(rating);
  if (title !== undefined) review.title = title;
  if (comment !== undefined) review.comment = comment.trim();
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    review.status = status;
  }

  await review.save();

  // Recalculate product rating
  await recalculateProductRating(review.product);

  return res.status(200).json({
    success: true,
    message: "Review updated successfully.",
    data: review,
  });
});

/**
 * @desc    Admin: Delete review
 * @route   DELETE /api/admin/review/:reviewId
 * @access  Private (Admin)
 */
exports.deleteReviewAdmin = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const review = await Review.findById(reviewId);

  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found.",
    });
  }

  const productId = review.product;
  await Review.findByIdAndDelete(reviewId);

  // Recalculate product rating
  const stats = await recalculateProductRating(productId);

  return res.status(200).json({
    success: true,
    message: "Review deleted successfully.",
    productStats: stats,
  });
});
