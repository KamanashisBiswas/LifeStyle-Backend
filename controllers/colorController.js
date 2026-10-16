/**
 * ============================================================
 * controllers/colorController.js — Color Management
 * ============================================================
 * পণ্যের বর্ণ / color তৈরি, দেখা, update, delete handle করে।
 * Product variation ঊ রঙ বিকল্প দেওয়ার জন্য এই list request করা হয়।
 *
 * API Endpoints:
 *  POST   /api/color        → createColor()     — নতুন color তৈরি
 *  GET    /api/color/all    → getAllColorsAdmin() — Admin: সব colors
 *  GET    /api/color        → getAllColors()     — Public: active colors
 *  GET    /api/color/:id    → getColorById()    — একটি color
 *  PUT    /api/color/:id    → updateColor()     — update
 *  DELETE /api/color/:id    → deleteColor()     — delete (admin only)
 * ============================================================
 */

const Color = require("../models/Color");
const Counter = require("../models/Counter");
const asyncHandler = require("../utils/asyncHandler");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

// Create Color
const createColor = asyncHandler(async (req, res) => {
  const count = await Color.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Color" },
    { seq: count + 1 },
    { upsert: true },
  );
  const colorId = `CLR-${String(count + 1).padStart(5, "0")}`;
  const color = await Color.create({
    colorId,
    name: req.body.name,
    description: req.body.description,
    image: req.file?.path || req.file?.url,
    isActive: req.body.isActive !== undefined ? req.body.isActive : true,
    createdBy: req.user.id,
  });
  res.status(201).json({ success: true, data: color });
});

// @desc    Get all colors (for admin/employee)
const getAllColorsAdmin = asyncHandler(async (req, res) => {
  const colors = await Color.find()
    .populate("createdBy", "name")
    .sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: colors });
});

// @desc    Get all active colors (for public/users)
const getAllColors = asyncHandler(async (req, res) => {
  const colors = await Color.find({ isActive: true }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: colors });
});

// Get Color by custom ID (public)
const getColorById = asyncHandler(async (req, res) => {
  const color = await Color.findOne({ colorId: req.params.id });
  if (!color) {
    return res.status(404).json({ success: false, message: "Color not found" });
  }
  res.status(200).json({ success: true, data: color });
});

// Update Color (employee, admin)
const updateColor = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  const color = await Color.findOne({ colorId: req.params.id });

  if (!color) {
    return res.status(404).json({ success: false, message: "Color not found" });
  }

  const updateData = {
    ...(name && { name }),
    ...(description && { description }),
    ...(isActive !== undefined && { isActive }),
  };

  // Handle image update
  if (req.file) {
    if (color.image) {
      const publicId = extractPublicIdFromUrl(color.image);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    updateData.image = req.file.path;
  }

  const updatedColor = await Color.findByIdAndUpdate(color._id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    message: "Color updated successfully",
    data: updatedColor,
  });
});

// Delete Color (admin only)
const deleteColor = asyncHandler(async (req, res) => {
  const color = await Color.findOneAndDelete({
    colorId: req.params.id,
  });
  if (!color)
    return res.status(404).json({ success: false, message: "Color not found" });

  // Delete image from Cloudinary if exists
  if (color.image) {
    const publicId = extractPublicIdFromUrl(color.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  const count = await Color.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Color" },
    { seq: count },
    { upsert: true },
  );
  res.status(200).json({ success: true, message: "Color deleted" });
});

module.exports = {
  createColor,
  getAllColors,
  getAllColorsAdmin,
  getColorById,
  updateColor,
  deleteColor,
};
