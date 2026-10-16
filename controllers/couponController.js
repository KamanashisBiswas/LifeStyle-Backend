/**
 * ============================================================
 * controllers/couponController.js — Coupon/Discount Code Management
 * ============================================================
 * Discount coupon তৈরি, দেখা, validate, update, delete handle করে।
 *
 * API Endpoints:
 *  POST   /api/coupon           → createCoupon()     — নতুন coupon তৈরি
 *  GET    /api/coupon           → getAllCoupons()     — Admin: সব coupons (pagination)
 *  GET    /api/coupon/:id       → getCouponById()    — একটি coupon
 *  PUT    /api/coupon/:id       → updateCoupon()     — update
 *  DELETE /api/coupon/:id       → deleteCoupon()     — delete
 *  POST   /api/coupon/validate  → validateCoupon()   — Customer checkout ঊ code validate
 *
 * validateCoupon কাজ:
 *  - code ঠিক আছে কিনা check
 *  - isActive আছে কিনা check
 *  - startTime ও endTime সীমার মধ্যে আছে কিনা check
 *  - discount amount calculate করে return করা
 * ============================================================
 */

const Coupon = require("../models/Coupon");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");

// Create Coupon
const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    title,
    description,
    type,
    discountValue,
    startTime,
    endTime,
    isActive,
  } = req.body;
  const coupon = await Coupon.create({
    code,
    title,
    description,
    type,
    discountValue,
    startTime,
    endTime,
    isActive,
    createdBy: req.user.id,
  });

  logActivity({
    req,
    action: "CREATE_COUPON",
    entityType: "Coupon",
    entityId: coupon.couponId || coupon.code,
    description: `Created new coupon: ${coupon.code}`,
    metadata: { code: coupon.code, discountValue: coupon.discountValue, type: coupon.type }
  });

  res.status(201).json({ success: true, data: coupon });
});

// Get All Coupons (admin/employee)
const getAllCoupons = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { code: regex },
      { title: regex },
      { description: regex },
      { type: regex },
    ];
  }

  let coupons;
  let total;

  if (pagination === "false") {
    coupons = await Coupon.find(filter)
      .populate("createdBy", "name email")
      .sort({ updatedAt: -1, createdAt: -1 });
    total = coupons.length;

    const [activeCount, inactiveCount] = await Promise.all([
      Coupon.countDocuments({ isActive: true }),
      Coupon.countDocuments({ isActive: false }),
    ]);

    const stats = {
      total,
      activeCount,
      inactiveCount,
    };

    return res.status(200).json({
      success: true,
      data: coupons,
      stats,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [couponsList, totalCount, activeCount, inactiveCount] = await Promise.all([
    Coupon.find(filter)
      .populate("createdBy", "name email")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Coupon.countDocuments(filter),
    Coupon.countDocuments({ isActive: true }),
    Coupon.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({
    success: true,
    data: couponsList,
    stats,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      totalItems: totalCount,
      total: totalCount,
      limit: limitNum,
    },
  });
});

// Get Single Coupon by couponId
const getCouponById = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({ couponId: req.params.id }).populate(
    "createdBy",
    "name email",
  );
  if (!coupon) {
    return res
      .status(404)
      .json({ success: false, message: "Coupon not found" });
  }
  res.status(200).json({ success: true, data: coupon });
});

// Update Coupon
const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({ couponId: req.params.id });
  if (!coupon) {
    return res
      .status(404)
      .json({ success: false, message: "Coupon not found" });
  }
  const updateData = { ...req.body };
  const updatedCoupon = await Coupon.findOneAndUpdate(
    { couponId: req.params.id },
    updateData,
    { new: true, runValidators: true },
  );

  logActivity({
    req,
    action: "UPDATE_COUPON",
    entityType: "Coupon",
    entityId: updatedCoupon.couponId || updatedCoupon.code,
    description: `Updated coupon details: ${updatedCoupon.code}`,
    metadata: { code: updatedCoupon.code, discountValue: updatedCoupon.discountValue }
  });

  res.status(200).json({ success: true, data: updatedCoupon });
});

// Delete Coupon
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOneAndDelete({ couponId: req.params.id });
  if (!coupon) {
    return res
      .status(404)
      .json({ success: false, message: "Coupon not found" });
  }

  logActivity({
    req,
    action: "DELETE_COUPON",
    entityType: "Coupon",
    entityId: coupon.couponId || coupon.code,
    description: `Deleted coupon: ${coupon.code}`,
    metadata: { code: coupon.code }
  });

  res
    .status(200)
    .json({ success: true, message: "Coupon deleted successfully" });
});

// Validate Coupon (for checkout)
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, purchaseAmount } = req.body;
  if (!code) {
    return res
      .status(400)
      .json({ success: false, message: "Coupon code is required." });
  }
  const coupon = await Coupon.findOne({
    code: { $regex: `^${code.trim()}$`, $options: "i" }, // case-insensitive match
    isActive: true,
  });
  if (!coupon) {
    return res
      .status(404)
      .json({ success: false, message: "Invalid or expired coupon code." });
  }

  // Date checks
  const now = new Date();
  if (coupon.startTime && now < coupon.startTime) {
    return res
      .status(400)
      .json({ success: false, message: "Coupon is not active yet." });
  }
  if (coupon.endTime && now > coupon.endTime) {
    return res
      .status(400)
      .json({ success: false, message: "Coupon has expired." });
  }

  // Calculate discount
  let discountAmount = 0;
  if (coupon.type === "Percentage") {
    discountAmount = Math.round(
      (purchaseAmount * Number(coupon.discountValue)) / 100,
    );
  } else if (coupon.type === "Fixed") {
    discountAmount = Number(coupon.discountValue);
  }
  if (discountAmount > purchaseAmount) discountAmount = purchaseAmount;

  res.json({
    success: true,
    discountAmount,
    message: `Coupon applied! You saved ৳${discountAmount}`,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      title: coupon.title,
      description: coupon.description,
      discountValue: coupon.discountValue,
    },
  });
});

module.exports = {
  createCoupon,
  getAllCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
};
