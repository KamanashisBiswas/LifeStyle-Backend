/**
 * ============================================================
 * routes/offer.js — Offer Routes
 * ============================================================
 * Base path: /api/offer (Public) and /api/admin/offer (Admin)
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  createOffer,
  getAllOffersAdmin,
  getOfferById,
  updateOffer,
  deleteOffer,
  searchProductsForOffer,
  addProductsToOffer,
  removeProductFromOffer,
  getActiveOffersPublic,
} = require("../controllers/offerController");

const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateOffer,
  validateUpdateOffer,
  validateAddProducts,
} = require("../validations/offerValidation");

const { offerBannerUpload } = require("../config/cloudinary");

const handleBannerUpload = (req, res, next) => {
  offerBannerUpload.array("bannerImages", 10)(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "Banner image too large. Maximum allowed size is 20MB per image.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to upload banner image",
      });
    }
    next();
  });
};

// ─── Public Routes ──────────────────────────────────────────────────────────────
publicRouter.get("/active", getActiveOffersPublic);

// ─── Admin & Employee Protected Routes ───────────────────────────────────────
adminRouter.use(authenticate, authorize("admin", "employee", "offers.view", "offers.manage"));

adminRouter.get("/search-products", searchProductsForOffer);

adminRouter.route("/")
  .post(authorize("admin", "employee", "offers.create", "offers.manage"), handleBannerUpload, validateCreateOffer, createOffer)
  .get(getAllOffersAdmin);

adminRouter.route("/:id")
  .get(getOfferById)
  .put(authorize("admin", "employee", "offers.edit", "offers.manage"), handleBannerUpload, validateUpdateOffer, updateOffer)
  .delete(authorize("admin", "offers.delete"), deleteOffer);

adminRouter.route("/:id/products")
  .post(authorize("admin", "employee", "offers.edit", "offers.manage"), validateAddProducts, addProductsToOffer);

adminRouter.route("/:id/products/:productId")
  .delete(authorize("admin", "offers.delete"), removeProductFromOffer);

module.exports = {
  publicRouter,
  adminRouter,
};
