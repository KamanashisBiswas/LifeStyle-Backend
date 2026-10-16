/**
 * ============================================================
 * models/Carousel.js — Homepage Main Carousel Banner Model
 * ============================================================
 * Website ঊর homepage ঊ মূল বড় banner slider ঊর data সাভ করে।
 *
 * গুরুত্বপূর্ণ fields:
 *  - carouselId → auto-generated (CAR-00001 format)
 *  - coverImage → banner ঊর মূল ছবি (Cloudinary URL)
 *  - title → banner heading text
 *  - description → ব্যাখ্যামূলক text
 *  - buttonText, buttonUrl → "Shop Now" ধরনের CTA button
 *  - status → "active" থাকলে website ঊ show করবে, "inactive" হলে hide হবে
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const carouselSchema = new mongoose.Schema(
  {
    carouselId: {
      type: String,
      unique: true,
    },
    coverImage: {
      type: String,
      required: [true, "Cover image is required"],
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    buttonText: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    buttonUrl: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

carouselSchema.pre("save", async function (next) {
  if (this.isNew) {
    this.carouselId = await generateCustomId(
      "CAR",
      mongoose.model("Carousel"),
      "carouselId",
      "Carousel",
    );
  }
  next();
});

module.exports = mongoose.model("Carousel", carouselSchema);
