/**
 * ============================================================
 * controllers/offerDealController.js — Offer & Deal Management
 * ============================================================
 * Homepage ঊর special offer ও deal banner তৈরি, update, delete handle করে।
 *
 * API Endpoints:
 *  POST   /api/offer-deals        → createOfferDeal()       — নতুন offer deal তৈরি
 *  GET    /api/offer-deals        → getAllOfferDeals()       — Public: active offer deals
 *  GET    /api/offer-deals/admin  → getAllOfferDealsAdmin()  — Admin: সব offer deals
 *  GET    /api/offer-deals/:id    → getOfferDealById()      — একটি offer deal
 *  PUT    /api/offer-deals/:id    → updateOfferDeal()       — update
 *  DELETE /api/offer-deals/:id    → deleteOfferDeal()       — delete
 *
 * বিশেষ:
 *  - শিরোনাম (title) duplicate থাকতে পারব৅ না
 *  - startTime ঊ endTime দিয়ে offer ঊর সময়সীমা নির্ধারণ
 * ============================================================
 */

const OfferDeal = require("../models/OfferDeal");
const asyncHandler = require("../utils/asyncHandler");
const { generateCustomId } = require("../utils/customIdGenerator");
const { logActivity } = require("../utils/activityLogger");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

// Create OfferDeal
const createOfferDeal = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    type,
    regularPrice,
    offerPrice,
    discountPercentage,
    startTime,
    endTime,
    isActive,
  } = req.body;

  // Check if title already exists
  const existing = await OfferDeal.findOne({ title: title.trim() });
  if (existing) {
    return res.status(400).json({
      success: false,
      message: "Title already exist",
      errors: [{ field: "title", message: "Title already exist" }],
    });
  }

  const image = req.file?.path;

  const offerDeal = await OfferDeal.create({
    title,
    description,
    image,
    type,
    regularPrice,
    offerPrice,
    discountPercentage,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    isActive: isActive === "true" || isActive === true,
    createdBy: req.user.id,
  });

  // Populate createdBy field
  const populatedOfferDeal = await OfferDeal.findById(offerDeal._id).populate(
    "createdBy",
    "name email",
  );

  logActivity({
    req,
    action: "CREATE_COUPON",
    entityType: "Coupon",
    entityId: populatedOfferDeal.offerDealId || populatedOfferDeal._id,
    description: `Created new offer deal: ${populatedOfferDeal.title}`,
    metadata: { title: populatedOfferDeal.title, type: populatedOfferDeal.type }
  });

  res.status(201).json({
    success: true,
    message: "Offer deal created successfully",
    data: populatedOfferDeal,
  });
});

// Get All OfferDeals (Active only)
const getAllOfferDeals = asyncHandler(async (req, res) => {
  const offerDeals = await OfferDeal.find({ isActive: true })
    .populate("createdBy", "name email")
    .sort({ updatedAt: -1, createdAt: -1 });

  res.status(200).json({
    success: true,
    data: offerDeals,
  });
});

// Get All OfferDeals for Admin (including inactive)
const getAllOfferDealsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { title: regex },
      { description: regex },
      { type: regex },
    ];
  }

  let offerDeals;
  let total;

  const [totalCount, activeCount, inactiveCount] = await Promise.all([
    OfferDeal.countDocuments({}),
    OfferDeal.countDocuments({ isActive: true }),
    OfferDeal.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  if (pagination === "false") {
    offerDeals = await OfferDeal.find(filter)
      .populate("createdBy", "name email")
      .sort({ updatedAt: -1, createdAt: -1 });
    total = offerDeals.length;

    return res.status(200).json({
      success: true,
      data: offerDeals,
      stats,
    });
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  offerDeals = await OfferDeal.find(filter)
    .populate("createdBy", "name email")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  total = await OfferDeal.countDocuments(filter);

  res.status(200).json({
    success: true,
    data: offerDeals,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      total,
      limit: parseInt(limit),
    },
    stats,
  });
});

// Get OfferDeal by ID
const getOfferDealById = asyncHandler(async (req, res) => {
  const offerDeal = await OfferDeal.findOne({
    offerDealId: req.params.id,
  }).populate("createdBy", "name email");

  if (!offerDeal) {
    return res.status(404).json({
      success: false,
      message: "Offer deal not found",
    });
  }

  res.status(200).json({
    success: true,
    data: offerDeal,
  });
});

// Update OfferDeal
const updateOfferDeal = asyncHandler(async (req, res) => {
  const offerDeal = await OfferDeal.findOne({ offerDealId: req.params.id });

  if (!offerDeal) {
    return res.status(404).json({
      success: false,
      message: "Offer deal not found",
    });
  }

  const {
    title,
    description,
    type,
    regularPrice,
    offerPrice,
    discountPercentage,
    startTime,
    endTime,
    isActive,
  } = req.body;

  const image = req.file?.path;

  // Handle image update
  if (image && offerDeal.image) {
    const publicId = extractPublicIdFromUrl(offerDeal.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  // Update fields
  const updateData = {
    title,
    description,
    type,
    regularPrice,
    offerPrice,
    discountPercentage,
    startTime: startTime ? new Date(startTime) : offerDeal.startTime,
    endTime: endTime ? new Date(endTime) : offerDeal.endTime,
    isActive: isActive === "true" || isActive === true,
  };

  if (image) updateData.image = image;

  const updatedOfferDeal = await OfferDeal.findOneAndUpdate(
    { offerDealId: req.params.id },
    updateData,
    { new: true, runValidators: true },
  ).populate("createdBy", "name email");

  const dealChanges = [];
  if (req.body.title) dealChanges.push("title");
  if (req.body.description) dealChanges.push("description");
  if (image) dealChanges.push("image");
  const dealSummary = dealChanges.length > 0 ? ` (${dealChanges.join(", ")})` : "";

  logActivity({
    req,
    action: "UPDATE_COUPON",
    entityType: "Coupon",
    entityId: updatedOfferDeal.offerDealId || updatedOfferDeal._id,
    description: `Updated offer deal '${updatedOfferDeal.title}'${dealSummary}`,
    metadata: { title: updatedOfferDeal.title, updatedFields: dealChanges }
  });

  res.status(200).json({
    success: true,
    message: "Offer deal updated successfully",
    data: updatedOfferDeal,
  });
});

// Delete OfferDeal (Admin only)
const deleteOfferDeal = asyncHandler(async (req, res) => {
  const offerDeal = await OfferDeal.findOneAndDelete({
    offerDealId: req.params.id,
  });

  if (!offerDeal) {
    return res.status(404).json({
      success: false,
      message: "Offer deal not found",
    });
  }

  // Delete image from Cloudinary if exists
  if (offerDeal.image) {
    const publicId = extractPublicIdFromUrl(offerDeal.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  logActivity({
    req,
    action: "DELETE_COUPON",
    entityType: "Coupon",
    entityId: offerDeal.offerDealId || offerDeal._id,
    description: `Deleted offer deal: ${offerDeal.title}`,
    metadata: { title: offerDeal.title }
  });

  res.status(200).json({
    success: true,
    message: "Offer deal deleted successfully",
  });
});

module.exports = {
  createOfferDeal,
  getAllOfferDeals,
  getAllOfferDealsAdmin,
  getOfferDealById,
  updateOfferDeal,
  deleteOfferDeal,
};
