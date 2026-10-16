/**
 * ============================================================
 * models/CarouselRight.js — Homepage Right-Side Small Banner Model
 * ============================================================
 * Homepage ঊর মূল carousel ঊর ডান পাশে ছোট ব্যানার banner সাভ করে।
 * সাধারণত 2-3 টি banner একসাথে দেখানো হয়।
 *
 * গুরুত্বপূর্ণ fields:
 *  - carouselRightId → auto-generated
 *  - image → banner ছবি (Cloudinary URL)
 *  - order → কোন অর্ডারে দেখাবে (1, 2, 3)
 *  - buttonText, buttonUrl → CTA button
 *  - status → "active" / "inactive"
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const carouselRightSchema = new mongoose.Schema(
  {
    carouselRightId: {
      type: String,
      unique: true,
    },
    image: {
      type: String,
      required: [true, "Image is required"],
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: 100,
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
    order: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
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

carouselRightSchema.pre("save", async function (next) {
  if (this.isNew) {
    this.carouselRightId = await generateCustomId(
      "CRR",
      mongoose.model("CarouselRight"),
      "carouselRightId",
      "CarouselRight",
    );
  }
  next();
});

module.exports = mongoose.model("CarouselRight", carouselRightSchema);
