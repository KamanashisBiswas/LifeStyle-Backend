/**
 * ============================================================
 * routes/carouselRight.js — Homepage Right-Side Small Banner Routes
 * ============================================================
 * Base path: /api/carousel-right
 *
 * Route সমূহ:
 *  POST   /api/carousel-right        → authenticate + authorize(employee/admin) + upload, createCarouselRight
 *  GET    /api/carousel-right        → Public, getAllCarouselRight (active only)
 *  GET    /api/carousel-right/admin  → authenticate + authorize, getAllCarouselRightAdmin
 *  GET    /api/carousel-right/:id    → authenticate, getCarouselRightById
 *  PUT    /api/carousel-right/:id    → authenticate + authorize + upload, updateCarouselRight
 *  DELETE /api/carousel-right/:id    → authenticate + authorize(admin), deleteCarouselRight
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const {
  createCarouselRight,
  updateCarouselRight,
  getAllCarouselRightAdmin,
  getAllCarouselRight,
  getCarouselRightById,
  deleteCarouselRight,
} = require("../controllers/carouselRightController");
const {
  validateCreateCarouselRight,
  validateUpdateCarouselRight,
  validateCarouselRightId,
} = require("../validations/carouselRightValidation");
const { authenticate, authorize } = require("../middleware/auth");
const multer = require("multer");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
publicRouter.get("/", getAllCarouselRight);
publicRouter.get("/:id", validateCarouselRightId, getCarouselRightById);

// Protected routes
adminRouter.post(
  "/create",
  authenticate,
  authorize("admin", "employee", "cms.create", "cms.manage"),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateCreateCarouselRight,
  createCarouselRight,
);

adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "cms.edit", "cms.manage"),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateUpdateCarouselRight,
  updateCarouselRight,
);

adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "cms.delete", "cms.manage"),
  validateCarouselRightId,
  deleteCarouselRight,
);

adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "cms.view"),
  getAllCarouselRightAdmin,
);

module.exports = { publicRouter, adminRouter };
