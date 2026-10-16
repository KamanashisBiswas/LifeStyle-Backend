/**
 * ============================================================
 * controllers/headlineController.js — Scrolling Headline Management
 * ============================================================
 * Website ঊর স্ক্রল করা announcement ticker text manage করে।
 *
 * API Endpoints:
 *  POST   /api/headline        → createHeadline()  — নতুন headline (একই তথ্য duplicate হবে না)
 *  GET    /api/headline        → getHeadline()     — Public: active headline
 *  GET    /api/headline/all    → getAllHeadlines()  — Admin: সব headlines
 *  PUT    /api/headline/:id    → updateHeadline()  — update
 *  DELETE /api/headline/:id    → deleteHeadline()  — delete
 * ============================================================
 */

const Headline = require("../models/Headline");
const Counter = require("../models/Counter");
const asyncHandler = require("../utils/asyncHandler");

// Create Headline (only one allowed)
const createHeadline = asyncHandler(async (req, res) => {
  // Prevent duplicate offerText
  const exists = await Headline.findOne({ offerText: req.body.offerText });
  if (exists)
    return res
      .status(400)
      .json({ success: false, message: "This headline already exists" });

  const count = await Headline.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Headline" },
    { seq: count + 1 },
    { upsert: true },
  );
  const headlineId = `HDL-${String(count + 1).padStart(5, "0")}`;
  const headline = await Headline.create({
    headlineId,
    offerText: req.body.offerText,
    status: req.body.status,
    createdBy: req.user.id,
  });

  // Populate createdBy before sending response
  const populatedHeadline = await Headline.findById(headline._id).populate(
    "createdBy",
    "name email",
  );
  res.status(201).json({ success: true, data: populatedHeadline });
});

// Get Headline (only one)
const getHeadline = asyncHandler(async (req, res) => {
  const headline = await Headline.findOne().populate("createdBy", "name email");
  res.status(200).json({ success: true, data: headline });
});

// Get all Headlines
const getAllHeadlines = asyncHandler(async (req, res) => {
  const headlines = await Headline.find({ status: "active" }).populate(
    "createdBy",
    "name email",
  );
  res.status(200).json({ success: true, data: headlines });
});

// Get all Headlines (Admin)
const getAllHeadlinesAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, pagination, isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.status = "active";
  else if (isActive === "false") filter.status = "inactive";

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { offerText: regex },
      { headlineId: regex },
    ];
  }

  let headlines;
  let total;

  const [totalCount, activeCount, inactiveCount] = await Promise.all([
    Headline.countDocuments({}),
    Headline.countDocuments({ status: "active" }),
    Headline.countDocuments({ status: "inactive" }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  if (pagination === "false") {
    headlines = await Headline.find(filter)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });
    total = headlines.length;

    return res.status(200).json({
      success: true,
      data: headlines,
      stats,
    });
  }

  const limitNum = parseInt(limit, 10) || 20;
  const skip = (parseInt(page, 10) - 1) * limitNum;

  headlines = await Headline.find(filter)
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  total = await Headline.countDocuments(filter);

  res.status(200).json({
    success: true,
    data: headlines,
    pagination: {
      currentPage: parseInt(page, 10) || 1,
      totalPages: Math.ceil(total / limitNum) || 1,
      total,
      limit: limitNum,
    },
    stats,
  });
});

// Get Headline by ID
const getHeadlineById = asyncHandler(async (req, res) => {
  const headline = await Headline.findOne({
    headlineId: req.params.id,
  }).populate("createdBy", "name email");
  if (!headline)
    return res
      .status(404)
      .json({ success: false, message: "Headline not found" });
  res.status(200).json({ success: true, data: headline });
});

// Update Headline
const updateHeadline = asyncHandler(async (req, res) => {
  const headline = await Headline.findOne({ headlineId: req.params.id });
  if (!headline)
    return res
      .status(404)
      .json({ success: false, message: "Headline not found" });

  headline.offerText = req.body.offerText;
  headline.status = req.body.status;
  await headline.save();

  // Populate createdBy before sending response
  const populatedHeadline = await Headline.findById(headline._id).populate(
    "createdBy",
    "name email",
  );
  res.status(200).json({ success: true, data: populatedHeadline });
});

// Delete Headline
const deleteHeadline = asyncHandler(async (req, res) => {
  const headline = await Headline.findOneAndDelete({
    headlineId: req.params.id,
  });
  if (!headline)
    return res
      .status(404)
      .json({ success: false, message: "Headline not found" });

  const count = await Headline.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Headline" },
    { seq: count },
    { upsert: true },
  );
  res
    .status(200)
    .json({ success: true, message: "Headline deleted successfully" });
});

// Add to exports:
module.exports = {
  createHeadline,
  getHeadline,
  getAllHeadlines: getAllHeadlines, // keep /all for public (active only)
  getAllHeadlinesAdmin,
  updateHeadline,
  deleteHeadline,
  getHeadlineById,
};
