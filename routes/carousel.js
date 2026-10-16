/**
 * ============================================================
 * routes/carousel.js — Homepage Main Carousel Banner Routes
 * ============================================================
 * Base path: /api/carousel
 *
 * Route সমূহ:
 *  POST   /api/carousel        → authenticate + authorize(employee/admin) + memoryUpload, createCarousel
 *  GET    /api/carousel        → Public, getAllCarousel (active only)
 *  GET    /api/carousel/admin  → authenticate + authorize, getAllCarouselAdmin
 *  GET    /api/carousel/:id    → authenticate, getCarouselById
 *  PUT    /api/carousel/:id    → authenticate + authorize + memoryUpload, updateCarousel
 *  DELETE /api/carousel/:id    → authenticate + authorize(admin), deleteCarousel
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const {
  createCarousel,
  updateCarousel,
  getAllCarouselAdmin,
  getAllCarousel,
  getCarouselById,
  deleteCarousel,
} = require("../controllers/carouselController");
const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateCarousel,
  validateUpdateCarousel,
  validateCarouselId,
} = require("../validations/carouselValidation");
const multer = require("multer");
const carouselUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "cms.create", "cms.manage"),
  carouselUpload.fields([{ name: "coverImage", maxCount: 1 }]),
  validateCreateCarousel,
  createCarousel,
);

adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "cms.edit", "cms.manage"),
  carouselUpload.fields([{ name: "coverImage", maxCount: 1 }]),
  validateUpdateCarousel,
  updateCarousel,
);

adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "cms.view"),
  getAllCarouselAdmin,
);
publicRouter.get("/", getAllCarousel);
publicRouter.get("/:id", validateCarouselId, getCarouselById);
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "cms.delete", "cms.manage"),
  validateCarouselId,
  deleteCarousel,
);

module.exports = { publicRouter, adminRouter };
