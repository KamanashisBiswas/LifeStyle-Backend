/**
 * ============================================================
 * models/NewArrival.js — New Arrival Collection Model
 * ============================================================
 * Independent configuration for New Arrival products.
 *
 * Fields:
 *  - title → Collection title (e.g. "New Arrivals Collection")
 *  - description → Short subtitle / description
 *  - bannerImage → Cloudinary URL for header banner
 *  - autoIncludeDays → Number of days to automatically classify new products (default: 30)
 *  - manualProducts → Array of Product ObjectIds manually added by Admin
 *  - isActive → Enable/disable toggle
 * ============================================================
 */

const mongoose = require("mongoose");

const newArrivalSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "New Arrivals",
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      default: "Check out our latest fashion and apparel additions.",
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    bannerImage: {
      type: String,
      default: null,
    },
    autoIncludeDays: {
      type: Number,
      default: 30,
      min: [0, "autoIncludeDays cannot be negative"],
    },
    manualProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NewArrival", newArrivalSchema);
