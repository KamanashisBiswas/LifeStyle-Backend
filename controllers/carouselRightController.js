/**
 * ============================================================
 * controllers/carouselRightController.js — Right-Side Small Banner Management
 * ============================================================
 * Homepage ঊর মূল carousel ঊর ডান পাশে ছোট banner manage করে।
 * সাধারণত 2-3 টি ব্যানার একসাথে দেখানো হয়।
 *
 * API Endpoints:
 *  POST   /api/carousel-right        → createCarouselRight()     — নতুন banner তৈরি
 *  PUT    /api/carousel-right/:id    → updateCarouselRight()     — update
 *  GET    /api/carousel-right/admin  → getAllCarouselRightAdmin() — Admin: সব (active + inactive)
 *  GET    /api/carousel-right        → getAllCarouselRight()     — Public: active banners
 *  GET    /api/carousel-right/:id    → getCarouselRightById()   — একটি
 *  DELETE /api/carousel-right/:id    → deleteCarouselRight()    — delete
 * ============================================================
 */

const CarouselRight = require("../models/CarouselRight");
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

// Create CarouselRight
const createCarouselRight = asyncHandler(async (req, res) => {
  let imageUrl;
  if (req.files.image && req.files.image[0]) {
    const result = await uploadBufferToCloudinary(
      req.files.image[0].buffer,
      "lifestyle/carousel-right",
    );
    imageUrl = result.secure_url;
  }
  const carouselRight = await CarouselRight.create({
    image: imageUrl,
    title: req.body.title,
    buttonText: req.body.buttonText,
    buttonUrl: req.body.buttonUrl,
    order: req.body.order,
    status: req.body.status || "active",
    createdBy: req.user.id,
  });
  res.status(201).json({ success: true, data: carouselRight });
});

// Update CarouselRight
const updateCarouselRight = asyncHandler(async (req, res) => {
  const carouselRight = await CarouselRight.findOne({
    carouselRightId: req.params.id,
  });
  if (!carouselRight) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel Right not found" });
  }
  const updateData = {};
  ["title", "buttonText", "buttonUrl", "order", "status"].forEach((field) => {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  });
  if (req.files.image && req.files.image[0]) {
    if (carouselRight.image) {
      const publicId = extractPublicIdFromUrl(carouselRight.image);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    const result = await uploadBufferToCloudinary(
      req.files.image[0].buffer,
      "lifestyle/carousel-right",
    );
    updateData.image = result.secure_url;
  }
  const updatedCarouselRight = await CarouselRight.findByIdAndUpdate(
    carouselRight._id,
    updateData,
    { new: true, runValidators: true },
  );
  res.status(200).json({ success: true, data: updatedCarouselRight });
});

const getAllCarouselRightAdmin = asyncHandler(async (req, res) => {
  const { isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.status = "active";
  else if (isActive === "false") filter.status = "inactive";

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { title: regex },
      { buttonText: regex },
    ];
  }

  const [carouselRights, total, activeCount, inactiveCount] = await Promise.all([
    CarouselRight.find(filter)
      .sort({ order: 1 })
      .populate("createdBy", "name email"),
    CarouselRight.countDocuments({}),
    CarouselRight.countDocuments({ status: "active" }),
    CarouselRight.countDocuments({ status: "inactive" }),
  ]);

  const stats = {
    total,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({ success: true, data: carouselRights, stats });
});

// Get All CarouselRight (Active)
const getAllCarouselRight = asyncHandler(async (req, res) => {
  const carouselRights = await CarouselRight.find({ status: "active" })
    .sort({ order: 1 })
    .populate("createdBy", "name email");
  res.status(200).json({ success: true, data: carouselRights });
});

// Get CarouselRight By Id
const getCarouselRightById = asyncHandler(async (req, res) => {
  const carouselRight = await CarouselRight.findOne({
    carouselRightId: req.params.id,
  }).populate("createdBy", "name email");
  if (!carouselRight) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel Right not found" });
  }
  res.status(200).json({ success: true, data: carouselRight });
});

// Delete CarouselRight
const deleteCarouselRight = asyncHandler(async (req, res) => {
  const carouselRight = await CarouselRight.findOne({
    carouselRightId: req.params.id,
  });
  if (!carouselRight) {
    return res
      .status(404)
      .json({ success: false, message: "Carousel Right not found" });
  }
  if (carouselRight.image) {
    const publicId = extractPublicIdFromUrl(carouselRight.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }
  await carouselRight.deleteOne();
  res.status(200).json({ success: true, message: "Carousel Right deleted" });
});

module.exports = {
  createCarouselRight,
  updateCarouselRight,
  getAllCarouselRightAdmin,
  getAllCarouselRight,
  getCarouselRightById,
  deleteCarouselRight,
};
