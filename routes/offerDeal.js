/**
 * ============================================================
 * routes/offerDeal.js — Offer & Deal Routes
 * ============================================================
 * Base path: /api/offer-deals
 *
 * Route সমূহ:
 *  POST   /api/offer-deals        → authenticate + authorize(employee/admin) + upload, createOfferDeal
 *  GET    /api/offer-deals        → Public, getAllOfferDeals (active only)
 *  GET    /api/offer-deals/admin  → authenticate + authorize, getAllOfferDealsAdmin
 *  GET    /api/offer-deals/:id    → authenticate, getOfferDealById
 *  PUT    /api/offer-deals/:id    → authenticate + authorize + upload, updateOfferDeal
 *  DELETE /api/offer-deals/:id    → authenticate + authorize(admin), deleteOfferDeal
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const { offerDealUpload } = require("../config/cloudinary");

const {
  createOfferDeal,
  getAllOfferDeals,
  getAllOfferDealsAdmin,
  getOfferDealById,
  updateOfferDeal,
  deleteOfferDeal,
} = require("../controllers/offerDealController");

const { authenticate, authorize } = require("../middleware/auth");
const {
  validateCreateOfferDeal,
  validateUpdateOfferDeal,
  validateOfferDealId,
} = require("../validations/offerDealValidation");

// Create OfferDeal (Employee, Admin)
adminRouter.post(
  "/",
  authenticate,
  authorize("employee", "admin", "offers.create", "offers.manage"),
  offerDealUpload.single("image"),
  validateCreateOfferDeal,
  createOfferDeal,
);

// Get All OfferDeals (Public)
publicRouter.get("/", getAllOfferDeals);

// Get All OfferDeals for Admin (including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("employee", "admin", "offers.view"),
  getAllOfferDealsAdmin,
);

// Get OfferDeal by ID (Public)
publicRouter.get("/:id", getOfferDealById);

// Update OfferDeal (Employee, Admin)
adminRouter.put(
  "/:id",
  authenticate,
  authorize("employee", "admin", "offers.edit", "offers.manage"),
  offerDealUpload.single("image"),
  validateUpdateOfferDeal,
  updateOfferDeal,
);

// Delete OfferDeal (Admin only)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "offers.delete", "offers.manage"),
  validateOfferDealId,
  deleteOfferDeal,
);

module.exports = { publicRouter, adminRouter };
