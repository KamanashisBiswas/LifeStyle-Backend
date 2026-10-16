/**
 * ============================================================
 * models/Brand.js — Product Brand Model
 * ============================================================
 * পণ্যের brand তথ্য সাভ করে (যেমন: Nike, Adidas, Samsung)।
 *
 * গুরুত্বপূর্ণ fields:
 *  - brandId → auto-generated pre-save hook ঊর মাধ্যমে (BRD-00001 format)
 *  - name → unique
 *  - image → optional Cloudinary URL
 *  - isActive → false হলে website ঊর filter ঊ দেখাবে না
 *  - createdBy → কোন admin/employee তৈরি করেছে
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const brandSchema = new mongoose.Schema(
  {
    brandId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      default: null,
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
brandSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.brandId = await generateCustomId(
      "BRD",
      mongoose.model("Brand"),
      "brandId",
      "Brand",
    );
  }
  next();
});

module.exports = mongoose.model("Brand", brandSchema);
