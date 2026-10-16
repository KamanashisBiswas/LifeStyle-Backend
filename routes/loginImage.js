/**
 * ============================================================
 * routes/loginImage.js — Login Page Image Routes
 * ============================================================
 * Base path: /api/login-image
 *
 * Route সমূহ:
 *  POST   /api/login-image        → authenticate + authorize(employee/admin) + memoryUpload, createLoginImage
 *  GET    /api/login-image        → Public, getAllLoginImages (active)
 *  GET    /api/login-image/admin  → authenticate + authorize, getAllLoginImagesAdmin
 *  GET    /api/login-image/:id    → Public, getLoginImageById
 *  PUT    /api/login-image/:id    → authenticate + authorize + upload, updateLoginImage
 *  DELETE /api/login-image/:id    → authenticate + authorize(admin), deleteLoginImage
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const {
  createLoginImage,
  getAllLoginImages,
  getLoginImageById,
  updateLoginImage,
  deleteLoginImage,
  getAllLoginImagesAdmin,
} = require("../controllers/loginImageController");

const { authenticate, authorize } = require("../middleware/auth");
const { loginImageMemoryUpload } = require("../config/cloudinary");

const {
  validateCreateLoginImage,
  validateUpdateLoginImage,
  validateLoginImageId,
} = require("../validations/loginImageValidation");

// Create Login Image (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("employee", "admin", "cms.create", "cms.manage"),
  loginImageMemoryUpload.fields([
    { name: "logo", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "bgImage", maxCount: 1 },
  ]),
  validateCreateLoginImage,
  createLoginImage,
);

// Get All Login Images (Public)
publicRouter.get("/", getAllLoginImages);

// Get All Login Images (admin/employee, including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("employee", "admin", "cms.view"),
  getAllLoginImagesAdmin,
);

// Get Login Image by custom ID (Public)
publicRouter.get("/:id", validateLoginImageId, getLoginImageById);

// Update Login Image (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("employee", "admin", "cms.edit", "cms.manage"),
  loginImageMemoryUpload.fields([
    { name: "logo", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "bgImage", maxCount: 1 },
  ]),
  validateUpdateLoginImage, // <-- CORRECT, does NOT include checkLoginImage
  updateLoginImage,
);

// Delete Login Image (Admin only)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "cms.delete", "cms.manage"),
  validateLoginImageId,
  deleteLoginImage,
);

module.exports = { publicRouter, adminRouter };
