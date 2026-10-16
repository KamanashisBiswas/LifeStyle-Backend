/**
 * ============================================================
 * routes/subCategory.js — SubCategory Routes
 * ============================================================
 * Base path: /api/subcategory
 *
 * Route সমূহ:
 *  POST   /api/subcategory                         → authenticate + authorize + upload, createSubCategory
 *  GET    /api/subcategory                         → Public, getAllSubCategories (active)
 *  GET    /api/subcategory/all                     → authenticate + authorize, getAllSubCategoriesAdmin
 *  GET    /api/subcategory/by-category/:categoryId → Public, getSubCategoriesByCategory
 *  GET    /api/subcategory/:id                     → Public, getSubCategoryById
 *  PUT    /api/subcategory/:id                     → authenticate + authorize + upload, updateSubCategory
 *  DELETE /api/subcategory/:id                     → authenticate + authorize(admin), deleteSubCategory
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createSubCategory,
  getAllSubCategories,
  getAllSubCategoriesAdmin, // <-- import new controller
  getSubCategoriesByCategory,
  getSubCategoriesByCategoryAdmin, // <-- Add this import
  getSubCategoryById,
  updateSubCategory,
  deleteSubCategory,
} = require("../controllers/subCategoryController");

const { authenticate, authorize } = require("../middleware/auth");
const { subCategoryUpload } = require("../config/cloudinary");
const {
  validateCreateSubCategory,
  validateUpdateSubCategory,
  validateSubCategoryId,
} = require("../validations/subCategoryValidation");

// @route   POST /api/subcategory
// @desc    Create a new sub category
// @access  Private (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "subcategories.create", "categories.manage"),
  subCategoryUpload.single("image"),
  validateCreateSubCategory,
  createSubCategory,
);

// @route   GET /api/subcategory
// @desc    Get all active sub categories (with optional category filter)
// @access  Public
publicRouter.get("/", getAllSubCategories);

// @route   GET /api/admin/subcategory
// @desc    Get all sub categories (including inactive) for admin/employee/manager
// @access  Private (Employee, Admin, Manager)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "subcategories.view", "categories.view", "categories.manage", "products.view"),
  getAllSubCategoriesAdmin,
);

// @route   GET /api/subcategory/category/:categoryId
// @desc    Get sub categories by category custom ID
// @access  Public
publicRouter.get("/category/:categoryId", getSubCategoriesByCategory);

// @route   GET /api/admin/subcategory/category/:categoryId
// @desc    Get sub categories by category custom ID (Admin - includes inactive)
// @access  Private (Employee, Admin, Manager)
adminRouter.get(
  "/category/:categoryId",
  authenticate,
  authorize("admin", "employee", "manager", "subcategories.view", "categories.view", "categories.manage", "products.view"),
  getSubCategoriesByCategoryAdmin,
);

// @route   GET /api/subcategory/:id
// @desc    Get a single sub category by its custom ID
// @access  Public
publicRouter.get("/:id", validateSubCategoryId, getSubCategoryById);

// @route   PUT /api/admin/subcategory/:id
// @desc    Update a sub category
// @access  Private (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "subcategories.edit", "categories.manage"),
  subCategoryUpload.single("image"),
  validateUpdateSubCategory,
  updateSubCategory,
);

// @route   DELETE /api/admin/subcategory/:id
// @desc    Delete a sub category
// @access  Private (Admin only or subcategories.delete)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "subcategories.delete"),
  validateSubCategoryId,
  deleteSubCategory,
);

module.exports = { publicRouter, adminRouter };
