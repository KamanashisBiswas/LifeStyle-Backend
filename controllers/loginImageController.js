/**
 * ============================================================
 * controllers/loginImageController.js — Login Page Image Management
 * ============================================================
 * Customer app/website ঊর login page ঊর ছবি (logo, banner, background) manage করে।
 *
 * API Endpoints:
 *  POST   /api/login-image        → createLoginImage()     — নতুন login image তৈরি
 *  GET    /api/login-image        → getAllLoginImages()    — সব login images
 *  GET    /api/login-image/active → getActiveLoginImage()  — Public: active login image
 *  GET    /api/login-image/:id    → getLoginImageById()   — একটি
 *  PUT    /api/login-image/:id    → updateLoginImage()    — update
 *  DELETE /api/login-image/:id    → deleteLoginImage()    — delete
 *
 * Image upload:
 *  Memory storage buffer থ৅কে Cloudinary stream ভিত্তিকভাবে multiple images (logo, image, bgImage) upload হয়
 * ============================================================
 */
// controllers/loginImageController.js
const LoginImage = require("../models/LoginImage");
const asyncHandler = require("../utils/asyncHandler");
const cloudinary = require("../config/cloudinary").cloudinary;
const {
  deleteImageFromCloudinary,
  extractPublicIdFromUrl,
} = require("../config/cloudinary");

// Helper function to upload buffer to Cloudinary
const uploadBufferToCloudinary = (buffer, folder, public_id) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

// Create Login Image
const createLoginImage = asyncHandler(async (req, res) => {
  // All validation (including image checks) now handled by `validateCreateLoginImage` middleware
  const existingCount = await LoginImage.countDocuments();
  if (existingCount >= 1) {
    return res.status(400).json({
      success: false,
      message:
        "Only one login image set allowed. Please edit or delete the existing set.",
    });
  }

  const uploadPromises = ["logo", "image", "bgImage"].map(async (field) => {
    if (req.files[field] && req.files[field][0]) {
      const result = await uploadBufferToCloudinary(
        req.files[field][0].buffer,
        "lifestyle/login-images",
      );
      return { field, url: result.secure_url };
    }
    return null;
  });

  const uploadedImages = (await Promise.all(uploadPromises)).filter(Boolean);

  const loginImage = await LoginImage.create({
    name: req.body.name,
    ...Object.fromEntries(uploadedImages.map((img) => [img.field, img.url])),
    isActive: true, // Assuming default value
    createdBy: req.user.id,
  });

  res.status(201).json({ success: true, data: loginImage });
});

// Update Login Image
const updateLoginImage = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const loginImage = await LoginImage.findOne({ loginImageId: req.params.id });

  if (!loginImage) {
    return res.status(404).json({
      success: false,
      message: "Login image set not found",
    });
  }

  const updateData = {};
  if (name) {
    updateData.name = name;
  }

  const imageFields = ["logo", "image", "bgImage"];
  const uploadPromises = imageFields.map(async (field) => {
    if (req.files && req.files[field] && req.files[field][0]) {
      // Delete previous image from Cloudinary
      if (loginImage[field]) {
        const publicId = extractPublicIdFromUrl(loginImage[field]);
        if (publicId) {
          await deleteImageFromCloudinary(publicId);
        }
      } // Upload new image
      const result = await uploadBufferToCloudinary(
        req.files[field][0].buffer,
        "lifestyle/login-images",
      );
      updateData[field] = result.secure_url;
    }
  });

  await Promise.all(uploadPromises);

  const updatedLoginImage = await LoginImage.findByIdAndUpdate(
    loginImage._id,
    updateData,
    { new: true, runValidators: true },
  );

  res.status(200).json({
    success: true,
    message: "Login image set updated successfully",
    data: updatedLoginImage,
  });
});

// Add these functions if not already present
const getAllLoginImagesAdmin = asyncHandler(async (req, res) => {
  const images = await LoginImage.find()
    .sort({ createdAt: -1 })
    .populate("createdBy", "name email"); // <-- Add this
  res.status(200).json({ success: true, data: images });
});

const getAllLoginImages = asyncHandler(async (req, res) => {
  const images = await LoginImage.find({ isActive: true })
    .sort({ createdAt: -1 })
    .populate("createdBy", "name email"); // <-- Add this
  res.status(200).json({ success: true, data: images });
});

const getLoginImageById = asyncHandler(async (req, res) => {
  const image = await LoginImage.findOne({
    loginImageId: req.params.id,
  }).populate("createdBy", "name email"); // <-- Add this
  if (!image) {
    return res
      .status(404)
      .json({ success: false, message: "Login image not found" });
  }
  res.status(200).json({ success: true, data: image });
});

const deleteLoginImage = asyncHandler(async (req, res) => {
  const image = await LoginImage.findOne({ loginImageId: req.params.id });
  if (!image) {
    return res
      .status(404)
      .json({ success: false, message: "Login image not found" });
  }
  // Delete images from Cloudinary
  for (const field of ["logo", "image", "bgImage"]) {
    if (image[field]) {
      const publicId = extractPublicIdFromUrl(image[field]);
      if (publicId) {
        await deleteImageFromCloudinary(publicId);
      }
    }
  }
  await image.deleteOne();
  res.status(200).json({ success: true, message: "Login image deleted" });
});

module.exports = {
  createLoginImage,
  updateLoginImage,
  getAllLoginImagesAdmin,
  getAllLoginImages,
  getLoginImageById,
  deleteLoginImage,
};
