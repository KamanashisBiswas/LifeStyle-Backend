/**
 * ============================================================
 * models/SubCategory.js — Product Sub-Category Model
 * ============================================================
 * Category ঊর মধ্যে sub-division বা উপ-বিভাগ।
 * যেমন: Men's Wear (মূল category) ঊর মধ্যে T-Shirt, Pants, Jacket (sub-category)
 *
 * গুরুত্বপূর্ণ fields:
 *  - subCategoryId → auto-generated (SUB-00001 format)
 *  - category → parent category ঊর ObjectId reference
 *  - isActive → false হলে website ঊ দেখাবে না
 *  - name + category combination প্রতি category ঊ unique হতে হবে
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const subCategorySchema = new mongoose.Schema(
  {
    subCategoryId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Sub-category name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      default: null,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Parent category is required"],
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
  { timestamps: true },
);

// Generate custom ID before saving a new document
subCategorySchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.subCategoryId = await generateCustomId(
      "SUB",
      mongoose.model("SubCategory"),
      "subCategoryId",
      "SubCategory",
    );
  }
  next();
});

// Ensure name is unique within the same parent category
subCategorySchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("SubCategory", subCategorySchema);
