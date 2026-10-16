/**
 * ============================================================
 * controllers/categoryController.js — Category Management
 * ============================================================
 * Product category তৈরি, দেখা, update, মুছে ফেলার সব operation handle করে।
 *
 * API Endpoints:
 *  POST   /api/category        → createCategory()        — নতুন category তৈরি
 *  GET    /api/category/all    → getAllCategoriesAdmin()  — Admin panel ঊর জন্য সব category (pagination)
 *  GET    /api/category        → getAllCategories()       — Public: শুধু active category
 *  GET    /api/category/:id    → getCategoryById()        — একটি category দেখা (categoryId দিয়ে)
 *  PUT    /api/category/:id    → updateCategory()         — category update (নাম, ছবি, status)
 *  DELETE /api/category/:id    → deleteCategory()         — category মুছে ফেলা (admin only)
 *
 * Image handling:
 *  - নতুন category তৈরিতে ছবি Cloudinary তে upload হয় (categoryUpload middleware)
 *  - Update ঊর সময় পুরানো ছবি Cloudinary থেকে মুছে নতুন ছবি সাভ হয়
 *  - Delete ঊর সময় ছবি Cloudinary থেকে মুছে ফেলা হয়
 * ============================================================
 */

const Category = require("../models/Category");
const Counter = require("../models/Counter"); // Import the Counter model if not already imported
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const {
  deleteImageFromCloudinary,
  extractPublicIdFromUrl,
} = require("../config/cloudinary");

// @desc    Create a new category
// @route   POST /api/category
// @access  Private (Employee, Admin)
const createCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;

  // Check for duplicate name (case-insensitive)
  const existing = await Category.findOne({
    name: { $regex: `^${name}$`, $options: "i" },
  });
  if (existing) {
    return res.status(400).json({
      success: false,
      message: "Category name must be unique",
    });
  }

  const count = await Category.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Category" },
    { seq: count + 1 },
    { upsert: true },
  );
  const categoryId = `CAT-${String(count + 1).padStart(5, "0")}`;
  const isActiveValue =
    req.body.isActive === "true" || req.body.isActive === true;
  const category = await Category.create({
    categoryId,
    name,
    description,
    isActive: isActiveValue,
    image: req.file?.path || null,
    createdBy: req.user.id,
  });

  logActivity({
    req,
    action: "CREATE_CATEGORY",
    entityType: "Category",
    entityId: category.categoryId || category._id,
    description: `Created new category: ${category.name} (${category.categoryId})`,
    metadata: { categoryId: category.categoryId, name: category.name }
  });

  res.status(201).json({ success: true, data: category });
});

// @desc    Get all categories (for admin/employee)
// @route   GET /api/category/all
// @access  Private (Employee, Admin)
const getAllCategoriesAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, q } = req.query;

  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { name: regex },
      { categoryId: regex },
      { description: regex },
    ];
  }

  let categories;
  let total;

  if (pagination === "false") {
    categories = await Category.find(filter)
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 });
    total = categories.length;

    const [activeCount, inactiveCount] = await Promise.all([
      Category.countDocuments({ isActive: true }),
      Category.countDocuments({ isActive: false }),
    ]);

    const stats = {
      total,
      activeCount,
      inactiveCount,
    };

    return res.status(200).json({
      success: true,
      data: categories,
      stats,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [categoriesList, totalCount, activeCount, inactiveCount] = await Promise.all([
    Category.find(filter)
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Category.countDocuments(filter),
    Category.countDocuments({ isActive: true }),
    Category.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({
    success: true,
    data: categoriesList,
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

// @desc    Get all active categories (for public/users)
// @route   GET /api/category
// @access  Public
const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({
    createdAt: -1, // <-- এখানে -1 এর বদলে 1 হবে
  });
  res.status(200).json({ success: true, data: categories });
});

// @desc    Get a single category by its custom ID
// @route   GET /api/category/:id
// @access  Public
const getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ categoryId: req.params.id });
  if (!category) {
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });
  }
  res.status(200).json({ success: true, data: category });
});

// @desc    Update a category
// @route   PUT /api/category/:id
// @access  Private (Employee, Admin)
const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  const category = await Category.findOne({ categoryId: req.params.id });

  if (!category) {
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });
  }

  const updateData = {
    ...(name && { name }),
    ...(description && { description }),
    ...(isActive !== undefined && {
      isActive: isActive === "true" || isActive === true,
    }),
  };

  // Handle image update
  if (req.file) {
    // Delete old image from Cloudinary
    if (category.image) {
      const publicId = extractPublicIdFromUrl(category.image);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    updateData.image = req.file.path;
  }

  // Remove duplicate isActive assignment; handled in updateData above

  const origName = category.name;
  const origDesc = category.description;
  const origStatus = category.isActive;

  const updatedCategory = await Category.findByIdAndUpdate(
    category._id,
    updateData,
    {
      new: true,
      runValidators: true,
    },
  );

  const catChanges = [];
  if (name !== undefined && name !== origName) catChanges.push("name");
  if (description !== undefined && description !== origDesc) catChanges.push("description");
  if (updateData.isActive !== undefined && updateData.isActive !== origStatus) catChanges.push("status");
  if (req.file) catChanges.push("image");
  const catSummary = catChanges.length > 0 ? ` (${catChanges.join(", ")})` : "";

  logActivity({
    req,
    action: "UPDATE_CATEGORY",
    entityType: "Category",
    entityId: updatedCategory.categoryId || updatedCategory._id,
    description: `Updated category '${updatedCategory.name}'${catSummary}`,
    oldValues: { name: origName, description: origDesc, isActive: origStatus },
    newValues: { name: updatedCategory.name, description: updatedCategory.description, isActive: updatedCategory.isActive },
    metadata: { categoryId: updatedCategory.categoryId, name: updatedCategory.name, updatedFields: catChanges }
  });

  res.status(200).json({
    success: true,
    message: "Category updated successfully",
    data: updatedCategory,
  });
});

// @desc    Delete a category
// @route   DELETE /api/category/:id
// @access  Private (Admin only)
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOneAndDelete({
    categoryId: req.params.id,
  });
  if (!category)
    return res
      .status(404)
      .json({ success: false, message: "Category not found" });

  // Delete image from Cloudinary if exists
  if (category.image) {
    const publicId = extractPublicIdFromUrl(category.image);
    if (publicId) await deleteImageFromCloudinary(publicId);
  }

  logActivity({
    req,
    action: "DELETE_CATEGORY",
    entityType: "Category",
    entityId: category.categoryId || category._id,
    description: `Deleted category: ${category.name} (${category.categoryId})`,
    metadata: { categoryId: category.categoryId, name: category.name }
  });

  const count = await Category.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Category" },
    { seq: count },
    { upsert: true },
  );
  res
    .status(200)
    .json({ success: true, message: "Category deleted successfully" });
});

module.exports = {
  createCategory,
  getAllCategories,
  getAllCategoriesAdmin, // <-- export new controller
  getCategoryById,
  updateCategory,
  deleteCategory,
};
