/**
 * ============================================================
 * models/Header.js — Website Header Announcement Model
 * ============================================================
 * Website ঊর top header ঊর announcement/offer text সাভ করে।
 * এক সাথে শুধু একটি header থাকতে পারবে (controller ঎ check করা হয়)।
 *
 * গুরুত্বপূর্ণ fields:
 *  - headerId → auto-generated (HDR-00001 format)
 *  - offerText → header ঊ show হাওয়া offer message (যেমন: "Free shipping on orders above ৳999")
 *  - companyName → কোম্পানির নামে website title
 * ============================================================
 */

const mongoose = require("mongoose");

const headerSchema = new mongoose.Schema(
  {
    headerId: {
      type: String,
      unique: true,
    },
    offerText: {
      type: String,
      required: [true, "Offer text is required"],
      trim: true,
      maxlength: 200,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxlength: 100,
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
headerSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.headerId = await generateCustomId(
      "HDR",
      mongoose.model("Header"),
      "headerId",
      "Header",
    );
  }
  next();
});

module.exports = mongoose.model("Header", headerSchema);
