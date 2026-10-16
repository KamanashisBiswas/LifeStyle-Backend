/**
 * ============================================================
 * controllers/brandController.js — Brand Management
 * ============================================================
 * পণ্যের brand তৈরি, দেখা, update, delete handle করে।
 *
 * API Endpoints:
 *  POST   /api/brand        → createBrand()     — নতুন brand তৈরি
 *  GET    /api/brand/all    → getAllBrandsAdmin() — Admin: সব brand (pagination support)
 *  GET    /api/brand        → getAllBrands()     — Public: active brands
 *  GET    /api/brand/:id    → getBrandById()    — একটি brand
 *  PUT    /api/brand/:id    → updateBrand()     — update
 *  DELETE /api/brand/:id    → deleteBrand()     — delete (admin only)
 * ============================================================
 */

const Brand = require("../models/Brand");
const Counter = require("../models/Counter"); // <-- Import Counter model if not already imported
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

// Create Brand
const createBrand = asyncHandler(async (req, res) => {
  const count = await Brand.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Brand" },
    { seq: count + 1 },
    { upsert: true },
  );
  const brandId = `BRD-${String(count + 1).padStart(5, "0")}`;
  const brand = await Brand.create({
    brandId,
    name: req.body.name,
    description: req.body.description,
    image: req.file?.path || req.file?.url, // Use .url if using cloudinary
    isActive: req.body.isActive !== undefined ? req.body.isActive : true,
    createdBy: req.user.id,
  });

  logActivity({
    req,
    action: "CREATE_BRAND",
    entityType: "Brand",
    entityId: brand.brandId || brand._id,
    description: `Created new brand: ${brand.name} (${brand.brandId})`,
    metadata: { brandId: brand.brandId, name: brand.name }
  });

  res.status(201).json({ success: true, data: brand });
});

// @desc    Get all brands (for admin/employee)
const getAllBrandsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { name: regex },
      { brandId: regex },
      { description: regex },
    ];
  }

  let brands;
  let total;

  const Product = require("../models/Product");

  if (pagination === "false") {
    brands = await Brand.find(filter)
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 });
    total = brands.length;

    const [activeCount, inactiveCount] = await Promise.all([
      Brand.countDocuments({ isActive: true }),
      Brand.countDocuments({ isActive: false }),
    ]);

    const stats = {
      total,
      activeCount,
      inactiveCount,
    };

    const brandsWithProductCount = await Promise.all(
      brands.map(async (brand) => {
        const productCount = await Product.countDocuments({ brand: brand._id });
        return { ...brand.toObject(), productCount };
      })
    );

    return res.status(200).json({
      success: true,
      data: brandsWithProductCount,
      stats,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [brandsList, totalCount, activeCount, inactiveCount] = await Promise.all([
    Brand.find(filter)
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Brand.countDocuments(filter),
    Brand.countDocuments({ isActive: true }),
    Brand.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  const brandsWithProductCount = await Promise.all(
    brandsList.map(async (brand) => {
      const productCount = await Product.countDocuments({ brand: brand._id });
      return { ...brand.toObject(), productCount };
    })
  );

  res.status(200).json({
    success: true,
    data: brandsWithProductCount,
    stats,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      totalItems: totalCount,
      total: totalCount,
      limit: limitNum,
      hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
      hasPrevPage: pageNum > 1,
    },
  });
});

// @desc    Get all active brands (for public/users)
const getAllBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find({ isActive: true }).sort({ updatedAt: -1, createdAt: -1 }); // <-- এখানে -1 এর বদলে 1 হবে
  res.status(200).json({ success: true, data: brands });
});

// Get Brand by custom ID (public)
const getBrandById = asyncHandler(async (req, res) => {
  const brand = await Brand.findOne({ brandId: req.params.id });
  if (!brand) {
    return res.status(404).json({ success: false, message: "Brand not found" });
  }
  res.status(200).json({ success: true, data: brand });
});

// Update Brand (employee, admin)
const updateBrand = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  const brand = await Brand.findOne({ brandId: req.params.id });

  if (!brand) {
    return res.status(404).json({ success: false, message: "Brand not found" });
  }

  const updateData = {
    ...(name && { name }),
    ...(description && { description }),
    ...(isActive !== undefined && { isActive }),
  };

  // Handle image update
  if (req.file) {
    if (brand.image) {
      const publicId = extractPublicIdFromUrl(brand.image);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    updateData.image = req.file.path;
  }

  const origName = brand.name;
  const origDesc = brand.description;
  const origStatus = brand.isActive;

  const updatedBrand = await Brand.findByIdAndUpdate(brand._id, updateData, {
    new: true,
    runValidators: true,
  });

  const brandChanges = [];
  if (name !== undefined && name !== origName) brandChanges.push("name");
  if (description !== undefined && description !== origDesc) brandChanges.push("description");
  if (updateData.isActive !== undefined && updateData.isActive !== origStatus) brandChanges.push("status");
  if (req.file) brandChanges.push("image");
  const brandSummary = brandChanges.length > 0 ? ` (${brandChanges.join(", ")})` : "";

  logActivity({
    req,
    action: "UPDATE_BRAND",
    entityType: "Brand",
    entityId: updatedBrand.brandId || updatedBrand._id,
    description: `Updated brand '${updatedBrand.name}'${brandSummary}`,
    oldValues: { name: origName, description: origDesc, isActive: origStatus },
    newValues: { name: updatedBrand.name, description: updatedBrand.description, isActive: updatedBrand.isActive },
    metadata: { brandId: updatedBrand.brandId, name: updatedBrand.name, updatedFields: brandChanges }
  });

  res.status(200).json({
    success: true,
    message: "Brand updated successfully",
    data: updatedBrand,
  });
});

// Delete Brand (admin only)
const deleteBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.findOneAndDelete({
    brandId: req.params.id,
  });
  if (!brand)
    return res.status(404).json({ success: false, message: "Brand not found" });

  // Delete image from Cloudinary if exists
  if (brand.image) {
    const publicId = extractPublicIdFromUrl(brand.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  logActivity({
    req,
    action: "DELETE_BRAND",
    entityType: "Brand",
    entityId: brand.brandId || brand._id,
    description: `Deleted brand: ${brand.name} (${brand.brandId})`,
    metadata: { brandId: brand.brandId, name: brand.name }
  });

  const count = await Brand.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Brand" },
    { seq: count },
    { upsert: true },
  );
  res
    .status(200)
    .json({ success: true, message: "Brand deleted successfully" });
});

module.exports = {
  createBrand,
  getAllBrands,
  getAllBrandsAdmin, // <-- export new controller
  getBrandById,
  updateBrand,
  deleteBrand,
};
