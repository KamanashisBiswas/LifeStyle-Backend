/**
 * ============================================================
 * models/Offer.js — Offer Model
 * ============================================================
 * Promotional offer campaigns (Flash Sale, Just For You, etc.)
 *
 * Fields:
 *  - offerId → Custom unique ID (OFR-00001 format)
 *  - title → Offer campaign title
 *  - offerType → "flash-sale" | "just-for-you"
 *  - discountType → "percentage" | "fixed"
 *  - discountValue → Number (Percentage or Fixed amount)
 *  - priority → Higher priority wins when multiple active offers overlap
 *  - startDate, endDate → Active date range
 *  - isActive → Manual enable/disable toggle
 *  - createdBy → Ref to User
 *  - deletedAt, deletedBy → Soft delete support
 * ============================================================
 */

const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    offerId: {
      type: String,
      unique: true,
    },
    title: {
      type: String,
      required: [true, "Offer title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    offerType: {
      type: String,
      enum: {
        values: ["flash-sale", "just-for-you"],
        message: "offerType must be either 'flash-sale' or 'just-for-you'",
      },
      required: [true, "offerType is required"],
    },
    discountType: {
      type: String,
      enum: {
        values: ["percentage", "fixed"],
        message: "discountType must be either 'percentage' or 'fixed'",
      },
      required: [true, "discountType is required"],
    },
    discountValue: {
      type: Number,
      required: [true, "discountValue is required"],
      min: [0, "discountValue cannot be negative"],
    },
    priority: {
      type: Number,
      default: 0,
    },
    bannerImages: [
      {
        type: String,
      },
    ],
    startDate: {
      type: Date,
      required: [true, "startDate is required"],
    },
    endDate: {
      type: Date,
      required: [true, "endDate is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Custom ID Generator Pre-save hook
offerSchema.pre("save", async function (next) {
  if (this.isNew && !this.offerId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.offerId = await generateCustomId(
      "OFR",
      mongoose.model("Offer"),
      "offerId",
      "Offer"
    );
  }
  next();
});

// Helper virtual for computed status
offerSchema.virtual("status").get(function () {
  if (this.deletedAt) return "Disabled";
  if (!this.isActive) return "Disabled";
  const now = new Date();
  if (now < this.startDate) return "Upcoming";
  if (now > this.endDate) return "Expired";
  return "Running";
});

// Ensure virtuals are serialized in JSON
offerSchema.set("toJSON", { virtuals: true });
offerSchema.set("toObject", { virtuals: true });

// Compound indexes for fast query filtering
offerSchema.index({ offerType: 1, isActive: 1, deletedAt: 1, startDate: 1, endDate: 1 });
offerSchema.index({ priority: -1, createdAt: -1 });

module.exports = mongoose.model("Offer", offerSchema);
