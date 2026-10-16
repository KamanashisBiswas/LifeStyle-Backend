/**
 * ============================================================
 * models/OfferDeal.js — Offer & Deal Banner Model
 * ============================================================
 * Homepage ঊর বিশেষ offer ও deal banner সাভ করে।
 *
 * Type ধরন:
 *  - "Product" → নির্দিষ্ট পণ্যের উপর offer
 *  - "Shipping" → shipping discount offer
 *
 * গুরুত্বপূর্ণ fields:
 *  - offerDealId → auto-generated
 *  - regularPrice vs offerPrice → discount ঊর আগে/পরের মূল্য
 *  - discountPercentage → discount নণ হিসাবে
 *  - startTime, endTime → offer ঊর শুরু ও শেষ সময়
 *  - isActive → false হলে website ঊ দেখাবে না
 * ============================================================
 */

const mongoose = require("mongoose");

const offerDealSchema = new mongoose.Schema(
  {
    offerDealId: {
      type: String,
      unique: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    image: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ["Product", "Shipping"],
      required: [true, "Type is required"],
    },
    regularPrice: {
      type: Number,
      required: [true, "Regular price is required"],
      min: [0, "Regular price must be greater than or equal to 0"],
    },
    offerPrice: {
      type: Number,
      required: [true, "Offer price is required"],
      min: [0, "Offer price must be greater than or equal to 0"],
    },
    discountPercentage: {
      type: Number,
      required: [true, "Discount percentage is required"],
      min: [0, "Discount percentage must be greater than or equal to 0"],
      max: [100, "Discount percentage cannot exceed 100"],
    },
    startTime: {
      type: Date,
      required: [true, "Start time is required"],
    },
    endTime: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          // Defensive: check both dates exist and compare as numbers
          return (
            value &&
            this.startTime &&
            value.getTime() > this.startTime.getTime()
          );
        },
        message: "End time must be after start time",
      },
    },
    isActive: {
      type: Boolean,
      required: [true, "isActive status is required"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Generate custom offerDealId before saving
offerDealSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.offerDealId = await generateCustomId(
      "OFD",
      mongoose.model("OfferDeal"),
      "offerDealId",
      "OfferDeal",
    );
  }
  next();
});

module.exports = mongoose.model("OfferDeal", offerDealSchema);
