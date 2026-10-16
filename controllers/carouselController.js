/**
 * ============================================================
 * controllers/carouselController.js — Homepage Main Carousel Banner
 * ============================================================
 * Website homepage ঊর মূল বড় banner slider manage করে।
 *
 * API Endpoints:
 *  POST   /api/carousel        → createCarousel()     — নতুন banner তৈরি
 *  PUT    /api/carousel/:id    → updateCarousel()     — update
 *  GET    /api/carousel/admin  → getAllCarouselAdmin() — Admin: সব (active + inactive)
 *  GET    /api/carousel        → getAllCarousel()     — Public: active banners
 *  GET    /api/carousel/:id    → getCarouselById()   — একটি
 *  DELETE /api/carousel/:id    → deleteCarousel()    — delete
 *
 * Image upload:
 *  - Memory storage (buffer) থেকে Cloudinary তে upload stream ভিত্তিকভাবে নিজেই upload হয়
 *  - পুরনো ছবি update/delete ঊ Cloudinary থেকে মুস্তাফা হয়
 * ============================================================
 */

const Carousel = require("../models/Carousel");
const asyncHandler = require("../utils/asyncHandler");
const cloudinary = require("../config/cloudinary").cloudinary;
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

// Helper to upload buffer to Cloudinary
const uploadBufferToCloudinary = (buffer, folder, public_id) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

// Create Carousel
const createCarousel = asyncHandler(async (req, res) => {
  let coverImageUrl;
  if (req.files.coverImage && req.files.coverImage[0]) {
    const result = await uploadBufferToCloudinary(
      req.files.coverImage[0].buffer,
      "lifestyle/carousel",
    );
    coverImageUrl = result.secure_url;
  }
  const carousel = await Carousel.create({
    coverImage: coverImageUrl,
    title: req.body.title,
    description: req.body.description,
    buttonText: req.body.buttonText,
    buttonUrl: req.body.buttonUrl,
    status: req.body.status || "active",
    createdBy: req.user.id,
  });
  res.status(201).json({ success: true, data: carousel });
});

// Update Carousel
const updateCarousel = asyncHandler(async (req, res) => {
  const carousel = await Carousel.findOne({ carouselId: req.params.id });
  if (!carousel) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel not found" });
  }
  const updateData = {};
  ["title", "description", "buttonText", "buttonUrl", "status"].forEach(
    (field) => {
      if (req.body[field]) updateData[field] = req.body[field];
    },
  );
  if (req.files.coverImage && req.files.coverImage[0]) {
    if (carousel.coverImage) {
      const publicId = extractPublicIdFromUrl(carousel.coverImage);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    const result = await uploadBufferToCloudinary(
      req.files.coverImage[0].buffer,
      "lifestyle/carousel",
    );
    updateData.coverImage = result.secure_url;
  }
  const updatedCarousel = await Carousel.findByIdAndUpdate(
    carousel._id,
    updateData,
    { new: true, runValidators: true },
  );
  res.status(200).json({ success: true, data: updatedCarousel });
});

const getAllCarouselAdmin = asyncHandler(async (req, res) => {
  const { isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.status = "active";
  else if (isActive === "false") filter.status = "inactive";

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { title: regex },
      { description: regex },
      { buttonText: regex },
    ];
  }

  const [carousels, total, activeCount, inactiveCount] = await Promise.all([
    Carousel.find(filter)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email"),
    Carousel.countDocuments({}),
    Carousel.countDocuments({ status: "active" }),
    Carousel.countDocuments({ status: "inactive" }),
  ]);

  const stats = {
    total,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({ success: true, data: carousels, stats });
});

// Get All Carousel (Active)
const getAllCarousel = asyncHandler(async (req, res) => {
  const carousels = await Carousel.find({ status: "active" })
    .sort({ createdAt: -1 })
    .populate("createdBy", "name email"); // <-- Add this
  res.status(200).json({ success: true, data: carousels });
});

// Get Carousel By Id
const getCarouselById = asyncHandler(async (req, res) => {
  const carousel = await Carousel.findOne({
    carouselId: req.params.id,
  }).populate("createdBy", "name email"); // <-- Add this
  if (!carousel) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel not found" });
  }
  res.status(200).json({ success: true, data: carousel });
});

// Delete Carousel
const deleteCarousel = asyncHandler(async (req, res) => {
  const carousel = await Carousel.findOne({ carouselId: req.params.id });
  if (!carousel) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel not found" });
  }
  if (carousel.coverImage) {
    const publicId = extractPublicIdFromUrl(carousel.coverImage);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }
  await carousel.deleteOne();
  res.status(200).json({ success: true, message: "Carousel deleted" });
});

module.exports = {
  createCarousel,
  updateCarousel,
  getAllCarouselAdmin,
  getAllCarousel,
  getCarouselById,
  deleteCarousel,
};
