/**
 * ============================================================
 * models/OfferProduct.js — OfferProduct Relation Model
 * ============================================================
 * Scalable junction model mapping Products to Offers.
 *
 * Fields:
 *  - offerId → Ref to Offer
 *  - productId → Ref to Product
 *  - createdAt → Timestamp when attached
 * ============================================================
 */

const mongoose = require("mongoose");

const offerProductSchema = new mongoose.Schema(
  {
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

// Prevent duplicate attachments of the same product to the same offer
offerProductSchema.index({ offerId: 1, productId: 1 }, { unique: true });
offerProductSchema.index({ productId: 1 });
offerProductSchema.index({ offerId: 1 });

module.exports = mongoose.model("OfferProduct", offerProductSchema);
