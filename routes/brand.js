/**
 * ============================================================
 * routes/brand.js — Brand Routes
 * ============================================================
 * Base path: /api/brand
 *
 * Route সমূহ:
 *  POST   /api/brand        → authenticate + authorize(employee/admin) + brandUpload, createBrand
 *  GET    /api/brand        → Public, getAllBrands (active only)
 *  GET    /api/brand/all    → authenticate + authorize, getAllBrandsAdmin
 *  GET    /api/brand/:id    → Public, getBrandById
 *  PUT    /api/brand/:id    → authenticate + authorize + upload, updateBrand
 *  DELETE /api/brand/:id    → authenticate + authorize(admin), deleteBrand
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createBrand,
  getAllBrands,
  getBrandById,
  updateBrand,
  deleteBrand,
  getAllBrandsAdmin,
} = require("../controllers/brandController");

const { authenticate, authorize } = require("../middleware/auth");
const { brandUpload } = require("../config/cloudinary");
// const {
//   validateCreateBrand,
//   validateUpdateBrand,
//   validateBrandId,
// } = require("../validations/brandValidation");

const {
  validateCreateBrand,
  validateUpdateBrand,
  validateBrandId,
} = require("../validations/brandvalidation");

// Create Brand (Employee, Admin, or brands.manage)
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "brands.create", "brands.manage"),
  brandUpload.single("image"),
  validateCreateBrand,
  createBrand,
);

// Get All Brands (Public)
publicRouter.get("/", getAllBrands);

// Get All Brands (admin/employee/manager, including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "brands.view", "brands.manage", "products.view"),
  getAllBrandsAdmin,
);

// Get Brand by custom ID (Public)
publicRouter.get("/:id", validateBrandId, getBrandById);

// Update Brand (Employee, Admin, or brands.edit)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "brands.edit", "brands.manage"),
  brandUpload.single("image"),
  validateUpdateBrand,
  updateBrand,
);

// Delete Brand (Admin only or brands.delete)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "brands.delete"),
  validateBrandId,
  deleteBrand,
);

module.exports = { publicRouter, adminRouter };
