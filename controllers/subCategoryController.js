/**
 * ============================================================
 * controllers/subCategoryController.js — SubCategory Management
 * ============================================================
 * Category ঊর মধ্যনস্থ sub-division (sub-category) তৈরি, দেখা, update, delete handle করে।
 *
 * API Endpoints:
 *  POST   /api/subcategory         → createSubCategory()        — নতুন sub-category তৈরি
 *  GET    /api/subcategory/all     → getAllSubCategoriesAdmin()  — Admin ঊর জন্য সব (pagination)
 *  GET    /api/subcategory         → getAllSubCategories()       — Public: active sub-categories
 *  GET    /api/subcategory/by-category/:categoryId → getSubCategoriesByCategory() — নির্দিষ্ট category ঊর sub-categories
 *  GET    /api/subcategory/:id     → getSubCategoryById()        — একটি sub-category
 *  PUT    /api/subcategory/:id     → updateSubCategory()         — update
 *  DELETE /api/subcategory/:id     → deleteSubCategory()         — delete (admin only)
 *
 * Rule:
 *  এক category ঊ একই নামের sub-category duplicate থাকতে পারবে না
 * ============================================================
 */

const SubCategory = require("../models/SubCategory");
const Category = require("../models/Category");
const Counter = require("../models/Counter");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

// @desc    Create a new sub category
// @route   POST /api/subcategory
// @access  Private (Employee, Admin)
const createSubCategory = asyncHandler(async (req, res) => {
  const { name, description, category, isActive } = req.body; // <-- isActive যোগ করুন

  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Sub category image is required" });
  }

  // Check if category exists
  const existingCategory = await Category.findById(category);
  if (!existingCategory) {
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });
  }

  // Check if sub category with same name exists in this category
  const existingSubCategory = await SubCategory.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
    category,
  });
  if (existingSubCategory) {
    return res.status(400).json({
      success: false,
      message: "Sub category name already exists in this category",
    });
  }

  const count = await SubCategory.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "SubCategory" },
    { seq: count + 1 },
    { upsert: true },
  );
  const subCategoryId = `SUB-${String(count + 1).padStart(5, "0")}`;
  const subCategory = await SubCategory.create({
    subCategoryId,
    name,
    description,
    category,
    isActive, // <-- isActive পাঠান
    image: req.file.path, // Cloudinary URL
    createdBy: req.user.id,
  });

  // Populate category information
  await subCategory.populate("category", "name categoryId");

  logActivity({
    req,
    action: "CREATE_CATEGORY",
    entityType: "Category",
    entityId: subCategory.subCategoryId || subCategory._id,
    description: `Created new sub-category: ${subCategory.name} (${subCategory.subCategoryId})`,
    metadata: { subCategoryId: subCategory.subCategoryId, name: subCategory.name }
  });

  res.status(201).json({
    success: true,
    message: "Sub category created successfully",
    data: subCategory,
  });
});

// @desc    Get all sub-categories (for admin/employee)
// @route   GET /api/subcategory/all
// @access  Private (Employee, Admin)
const getAllSubCategoriesAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, q, category } = req.query;

  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (category && category !== "all") filter.category = category;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { name: regex },
      { subCategoryId: regex },
      { description: regex },
    ];
  }

  let subCategories;
  let total;

  if (pagination === "false") {
    subCategories = await SubCategory.find(filter)
      .populate("category", "name")
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 });
    total = subCategories.length;

    const [activeCount, inactiveCount] = await Promise.all([
      SubCategory.countDocuments({ isActive: true }),
      SubCategory.countDocuments({ isActive: false }),
    ]);

    const stats = {
      total,
      activeCount,
      inactiveCount,
    };

    return res.status(200).json({
      success: true,
      data: subCategories,
      stats,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [subCategoriesList, totalCount, activeCount, inactiveCount] = await Promise.all([
    SubCategory.find(filter)
      .populate("category", "name")
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    SubCategory.countDocuments(filter),
    SubCategory.countDocuments({ isActive: true }),
    SubCategory.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({
    success: true,
    data: subCategoriesList,
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

// @desc    Get all active sub-categories (for public/users)
// @route   GET /api/subcategory
// @access  Public
const getAllSubCategories = asyncHandler(async (req, res) => {
  const subCategories = await SubCategory.find({ isActive: true })
    .populate("category", "name")
    .sort({ updatedAt: -1, createdAt: -1 });

  res.status(200).json({
    success: true,
    data: subCategories,
    count: subCategories.length,
  });
});

// @desc    Get sub categories by category ID
// @route   GET /api/subcategory/category/:categoryId
// @access  Public
const getSubCategoriesByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  // Try to find category by both custom categoryId and MongoDB _id
  let category;

  // First, try to find by custom categoryId
  category = await Category.findOne({ categoryId });

  // If not found, try to find by MongoDB _id
  if (!category && categoryId.match(/^[0-9a-fA-F]{24}$/)) {
    category = await Category.findById(categoryId);
  }

  if (!category) {
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });
  }

  const subCategories = await SubCategory.find({
    category: category._id,
    isActive: true,
  })
    .populate("category", "name categoryId")
    .populate("createdBy", "name")
    .sort({ updatedAt: -1, createdAt: -1 });

  res.status(200).json({
    success: true,
    data: subCategories,
    count: subCategories.length,
    category: {
      id: category.categoryId,
      name: category.name,
    },
  });
});

// @desc    Get sub categories by category ID (Admin - includes inactive)
// @route   GET /api/subcategory/category/:categoryId/admin
// @access  Private (Employee, Admin)
const getSubCategoriesByCategoryAdmin = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  // Try to find category by custom categoryId, name, or MongoDB _id
  let category;

  // First, try to find by custom categoryId
  category = await Category.findOne({ categoryId });

  // If not found, try to find by name (case-insensitive)
  if (!category) {
    category = await Category.findOne({
      name: { $regex: `^${categoryId}$`, $options: "i" },
    });
  }

  // If not found, try to find by MongoDB _id
  if (!category && categoryId.match(/^[0-9a-fA-F]{24}$/)) {
    category = await Category.findById(categoryId);
  }

  if (!category) {
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });
  }

  // For admin, return all subcategories (including inactive)
  const subCategories = await SubCategory.find({
    category: category._id,
  })
    .populate("category", "name categoryId")
    .populate("createdBy", "name")
    .sort({ updatedAt: -1, createdAt: -1 });

  res.status(200).json({
    success: true,
    data: subCategories,
    count: subCategories.length,
    category: {
      id: category.categoryId,
      name: category.name,
    },
  });
});

// @desc    Get a single sub category by its custom ID
// @route   GET /api/subcategory/:id
// @access  Public
const getSubCategoryById = asyncHandler(async (req, res) => {
  const subCategory = await SubCategory.findOne({
    subCategoryId: req.params.id,
  })
    .populate("category", "name categoryId")
    .populate("createdBy", "name");

  if (!subCategory) {
    return res
      .status(404)
      .json({ success: false, message: "Sub category not found" });
  }

  res.status(200).json({ success: true, data: subCategory });
});

// @desc    Update a sub category
// @route   PUT /api/subcategory/:id
// @access  Private (Employee, Admin)
const updateSubCategory = asyncHandler(async (req, res) => {
  const { name, description, category, isActive } = req.body;
  const subCategory = await SubCategory.findOne({
    subCategoryId: req.params.id,
  });

  if (!subCategory) {
    return res
      .status(404)
      .json({ success: false, message: "Sub category not found" });
  }

  // If category is being changed, verify it exists
  if (category && category !== subCategory.category.toString()) {
    const existingCategory = await Category.findById(category);
    if (!existingCategory) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }
  }

  // Always check for duplicate name in the (possibly new) category
  const checkName = name || subCategory.name;
  const checkCategory = category || subCategory.category;
  const existingSubCategory = await SubCategory.findOne({
    name: { $regex: `^${checkName}$`, $options: "i" },
    category: checkCategory,
    _id: { $ne: subCategory._id },
  });
  if (existingSubCategory) {
    return res.status(400).json({
      success: false,
      message: "Sub category name already exists in this category",
    });
  }

  const updateData = {
    ...(name && { name }),
    ...(description && { description }),
    ...(category && { category }),
    ...(isActive !== undefined && { isActive }),
  };

  // Handle image update
  if (req.file) {
    // Delete old image from Cloudinary
    if (subCategory.image) {
      const publicId = extractPublicIdFromUrl(subCategory.image);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    updateData.image = req.file.path;
  }

  const origName = subCategory.name;
  const origDesc = subCategory.description;
  const origStatus = subCategory.isActive;

  const updatedSubCategory = await SubCategory.findByIdAndUpdate(
    subCategory._id,
    updateData,
    {
      new: true,
      runValidators: true,
    },
  )
    .populate("category", "name categoryId")
    .populate("createdBy", "name");

  const subCatChanges = [];
  if (name !== undefined && name !== origName) subCatChanges.push("name");
  if (description !== undefined && description !== origDesc) subCatChanges.push("description");
  if (updateData.isActive !== undefined && updateData.isActive !== origStatus) subCatChanges.push("status");
  if (req.file) subCatChanges.push("image");
  const subCatSummary = subCatChanges.length > 0 ? ` (${subCatChanges.join(", ")})` : "";

  logActivity({
    req,
    action: "UPDATE_SUBCATEGORY",
    entityType: "SubCategory",
    entityId: updatedSubCategory.subCategoryId || updatedSubCategory._id,
    description: `Updated sub-category '${updatedSubCategory.name}'${subCatSummary}`,
    oldValues: { name: origName, description: origDesc, isActive: origStatus },
    newValues: { name: updatedSubCategory.name, description: updatedSubCategory.description, isActive: updatedSubCategory.isActive },
    metadata: { subCategoryId: updatedSubCategory.subCategoryId, name: updatedSubCategory.name, updatedFields: subCatChanges }
  });

  res.status(200).json({
    success: true,
    message: "Sub category updated successfully",
    data: updatedSubCategory,
  });
});

// @desc    Delete a sub category
// @route   DELETE /api/subcategory/:id
// @access  Private (Admin only)
const deleteSubCategory = asyncHandler(async (req, res) => {
  const subCategory = await SubCategory.findOneAndDelete({
    subCategoryId: req.params.id,
  });
  if (!subCategory)
    return res
      .status(404)
      .json({ success: false, message: "SubCategory not found" });

  // Delete image from Cloudinary if exists
  if (subCategory.image) {
    const publicId = extractPublicIdFromUrl(subCategory.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  logActivity({
    req,
    action: "DELETE_CATEGORY",
    entityType: "Category",
    entityId: subCategory.subCategoryId || subCategory._id,
    description: `Deleted sub-category: ${subCategory.name} (${subCategory.subCategoryId})`,
    metadata: { subCategoryId: subCategory.subCategoryId, name: subCategory.name }
  });

  const count = await SubCategory.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "SubCategory" },
    { seq: count },
    { upsert: true },
  );
  res
    .status(200)
    .json({ success: true, message: "SubCategory deleted successfully" });
});

module.exports = {
  createSubCategory,
  getAllSubCategories,
  getAllSubCategoriesAdmin,
  getSubCategoriesByCategory,
  getSubCategoriesByCategoryAdmin, // <-- Add this line
  getSubCategoryById,
  updateSubCategory,
  deleteSubCategory,
};
