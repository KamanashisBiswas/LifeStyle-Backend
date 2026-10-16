/**
 * ============================================================
 * models/Headline.js — Website Scrolling Headline (Marquee) Model
 * ============================================================
 * Website ঊর homepage ঊ চলমান ticker/marquee text সাভ করে।
 * দুই headline রাখা যায় — active করাটি website ঊ দেখাবে।
 *
 * গুরুত্বপূর্ণ fields:
 *  - headlineId → auto-generated (HDL-00001 format)
 *  - offerText → স্ক্রল করা announcement text
 *  - status → "active" / "inactive" — active হলে website ঊ দেখাবে
 * ============================================================
 */

const mongoose = require("mongoose");

const headlineSchema = new mongoose.Schema(
  {
    headlineId: {
      type: String,
      unique: true,
    },
    offerText: {
      type: String,
      required: [true, "Offer text is required"],
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

headlineSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.headlineId = await generateCustomId(
      "HDL",
      mongoose.model("Headline"),
      "headlineId",
      "Headline",
    );
  }
  next();
});

module.exports = mongoose.model("Headline", headlineSchema);
