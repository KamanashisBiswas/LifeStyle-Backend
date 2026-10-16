/**
 * ============================================================
 * controllers/offerController.js — Offer Controller
 * ============================================================
 * Express controller handling all CRUD, product mapping,
 * priority resolution, and runtime dynamic pricing logic for offers.
 */

const asyncHandler = require("../utils/asyncHandler");
const { validationResult } = require("express-validator");
const Offer = require("../models/Offer");
const OfferProduct = require("../models/OfferProduct");
const Product = require("../models/Product");
const mongoose = require("mongoose");

// @desc    Create new offer
// @route   POST /api/admin/offer
// @access  Private (Admin / Employee)
const createOffer = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const userId = req.user.id || req.user._id;

  // Extract uploaded banner image URLs
  const bannerImages = req.files ? req.files.map((f) => f.path) : [];

  const offer = new Offer({
    title: req.body.title,
    offerType: req.body.offerType,
    discountType: req.body.discountType,
    discountValue: Number(req.body.discountValue),
    priority: req.body.priority ? Number(req.body.priority) : 0,
    startDate: new Date(req.body.startDate),
    endDate: new Date(req.body.endDate),
    isActive: req.body.isActive !== undefined ? String(req.body.isActive) === "true" || Boolean(req.body.isActive) : true,
    bannerImages,
    createdBy: userId,
  });

  await offer.save();

  res.status(201).json({
    success: true,
    message: "Offer created successfully",
    data: offer,
  });
});

// @desc    Get all offers for Admin (paginated, filtered)
// @route   GET /api/admin/offer
// @access  Private (Admin / Employee)
const getAllOffersAdmin = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { deletedAt: null };

  if (req.query.offerType && req.query.offerType !== "all") {
    query.offerType = req.query.offerType;
  }

  if (req.query.q && req.query.q.trim()) {
    query.title = { $regex: req.query.q.trim(), $options: "i" };
  }

  const now = new Date();

  if (req.query.status && req.query.status !== "all") {
    if (req.query.status === "disabled") {
      query.isActive = false;
    } else if (req.query.status === "upcoming") {
      query.isActive = true;
      query.startDate = { $gt: now };
    } else if (req.query.status === "expired") {
      query.isActive = true;
      query.endDate = { $lt: now };
    } else if (req.query.status === "running") {
      query.isActive = true;
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    }
  }

  const [total, runningCount, flashSaleCount, justForYouCount] = await Promise.all([
    Offer.countDocuments(query),
    Offer.countDocuments({
      deletedAt: null,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }),
    Offer.countDocuments({ deletedAt: null, offerType: "flash-sale" }),
    Offer.countDocuments({ deletedAt: null, offerType: "just-for-you" }),
  ]);

  const offers = await Offer.find(query)
    .populate("createdBy", "name email")
    .sort({ priority: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean({ virtuals: true });

  // Attach product counts for each offer via OfferProduct junction
  const offerIds = offers.map((o) => o._id);
  const productCounts = await OfferProduct.aggregate([
    { $match: { offerId: { $in: offerIds } } },
    { $group: { _id: "$offerId", count: { $sum: 1 } } },
  ]);

  const countMap = {};
  productCounts.forEach((c) => {
    countMap[c._id.toString()] = c.count;
  });

  const formattedOffers = offers.map((o) => {
    let computedStatus = "Disabled";
    if (o.isActive && !o.deletedAt) {
      const s = new Date(o.startDate);
      const e = new Date(o.endDate);
      if (now < s) computedStatus = "Upcoming";
      else if (now > e) computedStatus = "Expired";
      else computedStatus = "Running";
    }
    return {
      ...o,
      status: computedStatus,
      productCount: countMap[o._id.toString()] || 0,
    };
  });

  const stats = {
    total,
    runningCount,
    flashSaleCount,
    justForYouCount,
  };

  res.status(200).json({
    success: true,
    data: formattedOffers,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit) || 1,
      totalItems: total,
      limit,
    },
    stats,
  });
});

// @desc    Get single offer details with attached products
// @route   GET /api/admin/offer/:id
// @access  Private (Admin / Employee)
const getOfferById = asyncHandler(async (req, res) => {
  const offer = await Offer.findOne({ _id: req.params.id, deletedAt: null })
    .populate("createdBy", "name email")
    .lean({ virtuals: true });

  if (!offer) {
    return res.status(404).json({ success: false, message: "Offer not found" });
  }

  const offerProducts = await OfferProduct.find({ offerId: req.params.id })
    .populate({
      path: "productId",
      populate: [{ path: "category", select: "name" }],
    })
    .sort({ createdAt: -1 })
    .lean();

  const products = offerProducts
    .map((op) => op.productId)
    .filter(Boolean);

  const now = new Date();
  let computedStatus = "Disabled";
  if (offer.isActive && !offer.deletedAt) {
    const s = new Date(offer.startDate);
    const e = new Date(offer.endDate);
    if (now < s) computedStatus = "Upcoming";
    else if (now > e) computedStatus = "Expired";
    else computedStatus = "Running";
  }

  res.status(200).json({
    success: true,
    data: {
      ...offer,
      status: computedStatus,
      products,
      productCount: products.length,
    },
  });
});

// @desc    Update offer details
// @route   PUT /api/admin/offer/:id
// @access  Private (Admin / Employee)
const updateOffer = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const offer = await Offer.findOne({ _id: req.params.id, deletedAt: null });
  if (!offer) {
    return res.status(404).json({ success: false, message: "Offer not found" });
  }

  if (req.body.title !== undefined) offer.title = req.body.title;
  if (req.body.offerType !== undefined) offer.offerType = req.body.offerType;
  if (req.body.discountType !== undefined) offer.discountType = req.body.discountType;
  if (req.body.discountValue !== undefined) offer.discountValue = Number(req.body.discountValue);
  if (req.body.priority !== undefined) offer.priority = Number(req.body.priority);
  if (req.body.startDate !== undefined) offer.startDate = new Date(req.body.startDate);
  if (req.body.endDate !== undefined) offer.endDate = new Date(req.body.endDate);
  if (req.body.isActive !== undefined) {
    offer.isActive = String(req.body.isActive) === "true" || Boolean(req.body.isActive);
  }

  // Process bannerImages
  let currentImages = [];
  if (req.body.existingBannerImages) {
    try {
      currentImages = typeof req.body.existingBannerImages === "string"
        ? JSON.parse(req.body.existingBannerImages)
        : req.body.existingBannerImages;
      if (!Array.isArray(currentImages)) currentImages = [currentImages];
    } catch {
      currentImages = Array.isArray(req.body.existingBannerImages) ? req.body.existingBannerImages : [];
    }
  } else if (req.body.existingBannerImages === undefined && !req.files) {
    currentImages = offer.bannerImages || [];
  }

  const newUploaded = req.files ? req.files.map((f) => f.path) : [];
  offer.bannerImages = [...currentImages, ...newUploaded];

  await offer.save();

  res.status(200).json({
    success: true,
    message: "Offer updated successfully",
    data: offer,
  });
});

// @desc    Soft delete offer
// @route   DELETE /api/admin/offer/:id
// @access  Private (Admin / Employee)
const deleteOffer = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const offer = await Offer.findOne({ _id: req.params.id, deletedAt: null });

  if (!offer) {
    return res.status(404).json({ success: false, message: "Offer not found" });
  }

  offer.deletedAt = new Date();
  offer.deletedBy = userId;
  await offer.save();

  // Also clean up junction relation records
  await OfferProduct.deleteMany({ offerId: req.params.id });

  res.status(200).json({
    success: true,
    message: "Offer deleted successfully",
  });
});

// @desc    Search products for offer attachment
// @route   GET /api/admin/offer/search-products
// @access  Private (Admin / Employee)
const searchProductsForOffer = asyncHandler(async (req, res) => {
  const pPage = parseInt(req.query.page, 10) || 1;
  const pLimit = parseInt(req.query.limit, 10) || 15;
  const skip = (pPage - 1) * pLimit;

  const productQuery = { isActive: true };

  if (req.query.categoryId) {
    productQuery.category = req.query.categoryId;
  }

  if (req.query.q && req.query.q.trim()) {
    const searchRegex = new RegExp(req.query.q.trim(), "i");
    productQuery.$or = [
      { name: searchRegex },
      { productId: searchRegex },
      { "variation.sku": searchRegex },
    ];
  }

  const total = await Product.countDocuments(productQuery);
  const products = await Product.find(productQuery)
    .populate("category", "name")
    .select("productId name category variation isActive bannerImage images")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pLimit)
    .lean();

  // Check attached state for current target offerId if provided
  let attachedProductSet = new Set();
  if (req.query.offerId && mongoose.Types.ObjectId.isValid(req.query.offerId)) {
    const attachedOps = await OfferProduct.find({ offerId: req.query.offerId }).select("productId").lean();
    attachedProductSet = new Set(attachedOps.map((op) => op.productId.toString()));
  }

  const formattedProducts = products.map((p) => {
    const basePrices = (p.variation || []).map((v) => v.basePrice || 0);
    const minPrice = basePrices.length > 0 ? Math.min(...basePrices) : 0;
    const maxPrice = basePrices.length > 0 ? Math.max(...basePrices) : 0;

    return {
      _id: p._id,
      productId: p.productId,
      name: p.name,
      categoryName: p.category?.name || "N/A",
      skus: (p.variation || []).map((v) => v.sku).filter(Boolean),
      minPrice,
      maxPrice,
      isAttached: attachedProductSet.has(p._id.toString()),
      bannerImage: p.bannerImage || (p.variation && p.variation[0]?.images?.[0]) || null,
    };
  });

  res.status(200).json({
    success: true,
    data: formattedProducts,
    pagination: {
      currentPage: pPage,
      totalPages: Math.ceil(total / pLimit) || 1,
      totalItems: total,
      limit: pLimit,
    },
  });
});

// @desc    Attach products to offer
// @route   POST /api/admin/offer/:id/products
// @access  Private (Admin / Employee)
const addProductsToOffer = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const offer = await Offer.findOne({ _id: req.params.id, deletedAt: null });
  if (!offer) {
    return res.status(404).json({ success: false, message: "Offer not found" });
  }

  const validProducts = await Product.find({ _id: { $in: req.body.productIds } }).select("_id").lean();
  const validProductIds = validProducts.map((p) => p._id);

  if (validProductIds.length === 0) {
    return res.status(400).json({ success: false, message: "No valid products found to attach" });
  }

  const bulkOps = validProductIds.map((pid) => ({
    updateOne: {
      filter: { offerId: offer._id, productId: pid },
      update: { $setOnInsert: { createdAt: new Date() } },
      upsert: true,
    },
  }));

  await OfferProduct.bulkWrite(bulkOps);
  const updatedCount = await OfferProduct.countDocuments({ offerId: offer._id });

  res.status(200).json({
    success: true,
    message: "Products successfully added to offer",
    attachedCount: updatedCount,
  });
});

// @desc    Remove product from offer
// @route   DELETE /api/admin/offer/:id/products/:productId
// @access  Private (Admin / Employee)
const removeProductFromOffer = asyncHandler(async (req, res) => {
  const { id: offerId, productId } = req.params;
  await OfferProduct.deleteOne({ offerId, productId });
  const updatedCount = await OfferProduct.countDocuments({ offerId });

  res.status(200).json({
    success: true,
    message: "Product removed from offer",
    attachedCount: updatedCount,
  });
});

// @desc    Get active offers for public website (Flash Sale & Just For You)
// @route   GET /api/offer/active
// @access  Public
const getActiveOffersPublic = asyncHandler(async (req, res) => {
  const { offerType } = req.query;
  const query = {
    isActive: true,
    deletedAt: null,
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() },
  };

  if (offerType) {
    query.offerType = offerType;
  }

  const offers = await Offer.find(query)
    .sort({ priority: -1, createdAt: -1 })
    .lean({ virtuals: true });

  res.status(200).json({
    success: true,
    data: offers,
  });
});

module.exports = {
  createOffer,
  getAllOffersAdmin,
  getOfferById,
  updateOffer,
  deleteOffer,
  searchProductsForOffer,
  addProductsToOffer,
  removeProductFromOffer,
  getActiveOffersPublic,
};
