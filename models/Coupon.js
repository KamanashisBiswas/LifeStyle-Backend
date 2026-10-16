/**
 * ============================================================
 * models/Coupon.js — Coupon/Discount Code Model
 * ============================================================
 * Discount coupon code সাভ করে।
 * Customer checkout ঊ এই code ব্যবহার করে discount পায়।
 *
 * Coupon ধরন:
 *  - type: "Percentage" → মোট মূল্যের X% discount
 *  - type: "Fixed" → সরাসরি X টাকা discount
 *
 * গুরুত্বপূর্ণ fields:
 *  - couponId → auto-generated (CPN-00001 format)
 *  - code → unique coupon code (যেমন: SUMMER10, EID50)
 *  - discountValue → discount ঊর পরিমাণ
 *  - startTime, endTime → coupon যে সময় সীমার মধ্যে ব্যবহারযোগ্য
 *  - isActive → false হলে coupon apply হবে না
 *  - createdBy → কোন admin/employee তৈরি করেছে
 * ============================================================
 */

const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    couponId: {
      type: String,
      unique: true,
    },
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      trim: true,
      unique: true,
      maxlength: [50, "Code cannot exceed 50 characters"],
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
    type: {
      type: String,
      enum: ["Percentage", "Fixed"],
      required: [true, "Type is required"],
    },
    startTime: {
      type: Date,
    },
    endTime: {
      type: Date,
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
    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount value must be positive"],
    },
  },
  { timestamps: true },
);

// Generate custom couponId before saving
couponSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.couponId = await generateCustomId(
      "CPN",
      mongoose.model("Coupon"),
      "couponId",
      "Coupon",
    );
  }
  next();
});

module.exports = mongoose.model("Coupon", couponSchema);
