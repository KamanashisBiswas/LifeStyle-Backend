/**
 * ============================================================
 * models/Category.js — Product Category Model
 * ============================================================
 * পণ্যের মূল বিভাগ (যেমন: Men's Wear, Women's Wear, Electronics)।
 *
 * গুরুত্বপূর্ণ fields:
 *  - categoryId → auto-generated (CAT-00001 format), pre-save hook ঊর মাধ্যমে
 *  - name → unique, case-insensitive duplicate check controller ঊর মাধ্যমে
 *  - image → Cloudinary URL — category upload middleware দিয়ে upload হয়
 *  - isActive → false হলে website ঊর public page ঊ দেখাবে না
 *  - createdBy → কোন admin/employee তৈরি করেছে
 * ============================================================
 */

const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    categoryId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    image: {
      type: String,
      required: [true, "Category image is required"],
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
categorySchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.categoryId = await generateCustomId(
      "CAT",
      mongoose.model("Category"),
      "categoryId",
      "Category",
    );
  }
  next();
});

module.exports = mongoose.model("Category", categorySchema);
