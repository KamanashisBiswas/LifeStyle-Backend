/**
 * ============================================================
 * models/Color.js — Product Color Model
 * ============================================================
 * পণ্যের রঙ বিকল্প সাভ করে। Product variation তৈরিতে color reference হিসেবে ব্যবহার হয়।
 *
 * গুরুত্বপূর্ণ fields:
 *  - colorId → auto-generated (CLR-00001 format)
 *  - name → unique color name (যেমন: Red, Blue, Forest Green)
 *  - image → optional — color swatch ছবি
 *  - isActive → false হলে product filter ঊ show হবে না
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const colorSchema = new mongoose.Schema(
  {
    colorId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Color name is required"],
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
colorSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.colorId = await generateCustomId(
      "CLR",
      mongoose.model("Color"),
      "colorId",
      "Color",
    );
  }
  next();
});

module.exports = mongoose.model("Color", colorSchema);
