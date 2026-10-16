/**
 * ============================================================
 * routes/color.js — Color Routes
 * ============================================================
 * Base path: /api/color
 *
 * Route সমূহ:
 *  POST   /api/color        → authenticate + authorize(employee/admin) + colorUpload, createColor
 *  GET    /api/color        → Public, getAllColors (active only)
 *  GET    /api/color/all    → authenticate + authorize, getAllColorsAdmin
 *  GET    /api/color/:id    → Public, getColorById
 *  PUT    /api/color/:id    → authenticate + authorize + upload, updateColor
 *  DELETE /api/color/:id    → authenticate + authorize(admin), deleteColor
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createColor,
  getAllColors,
  getColorById,
  updateColor,
  deleteColor,
  getAllColorsAdmin,
} = require("../controllers/colorController");

const { authenticate, authorize } = require("../middleware/auth");
const { brandUpload } = require("../config/cloudinary");
const {
  validateCreateColor,
  validateUpdateColor,
  validateColorId,
} = require("../validations/colorValidation");

// Create Color (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("employee", "admin"),
  brandUpload.single("image"),
  validateCreateColor,
  createColor,
);

// Get All Colors (Public)
publicRouter.get("/", getAllColors);

// Get All Colors (admin/employee, including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("employee", "admin"),
  getAllColorsAdmin,
);

// Get Color by custom ID (Public)
publicRouter.get("/:id", validateColorId, getColorById);

// Update Color (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("employee", "admin"),
  brandUpload.single("image"),
  validateUpdateColor,
  updateColor,
);

// Delete Color (Admin)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin"),
  validateColorId,
  deleteColor,
);

module.exports = { publicRouter, adminRouter };
