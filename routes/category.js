/**
 * ============================================================
 * routes/category.js — Category Routes
 * ============================================================
 * Base path: /api/category
 *
 * Route সমূহ:
 *  POST   /api/category        → authenticate + image upload + validate, createCategory
 *  GET    /api/category        → Public, getAllCategories (active only)
 *  GET    /api/category/all    → authenticate + authorize(employee/admin/salesman), getAllCategoriesAdmin
 *  GET    /api/category/:id    → Public, getCategoryById
 *  PUT    /api/category/:id    → authenticate + authorize(employee/admin) + upload, updateCategory
 *  DELETE /api/category/:id    → authenticate + authorize(admin), deleteCategory
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createCategory,
  getAllCategories,
  getAllCategoriesAdmin,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController");

const { authenticate, authorize } = require("../middleware/auth");
const { categoryUpload } = require("../config/cloudinary");
const {
  validateCreateCategory,
  validateUpdateCategory,
  validateCategoryId,
} = require("../validations/categoryValidation");

// @route   POST /api/category
// @desc    Create a new category
// @access  Private (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "categories.create", "categories.manage"),
  categoryUpload.single("image"),
  validateCreateCategory,
  createCategory,
);

// @route   GET /api/category
// @desc    Get all active categories
// @access  Public
publicRouter.get("/", getAllCategories);

// @route   GET /api/admin/category
// @desc    Get all categories (including inactive) for admin/employee/manager
// @access  Private (Employee, Admin, Manager)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "categories.view", "categories.manage", "products.view"),
  getAllCategoriesAdmin,
);

// @route   GET /api/category/:id
// @desc    Get a single category by its custom ID
// @access  Public
publicRouter.get("/:id", validateCategoryId, getCategoryById);

// @route   PUT /api/category/:id
// @desc    Update a category
// @access  Private (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "categories.edit", "categories.manage"),
  categoryUpload.single("image"),
  validateUpdateCategory,
  updateCategory,
);

// @route   DELETE /api/admin/category/:id
// @desc    Delete a category
// @access  Private (Admin only or categories.delete)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "categories.delete"),
  validateCategoryId,
  deleteCategory,
);

module.exports = { publicRouter, adminRouter };
