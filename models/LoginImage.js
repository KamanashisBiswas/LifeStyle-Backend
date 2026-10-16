/**
 * ============================================================
 * models/LoginImage.js — Customer App Login Page Image Model
 * ============================================================
 * Customer mobile/web app ঊর login page ঊর ব্যাকগ্রাউন্ড ছবি সাভ করে।
 *
 * গুরুত্বপূর্ণ fields:
 *  - loginImageId → auto-generated (LGI-00001 format)
 *  - logo → app logo URL (optional)
 *  - image → main illustration URL (optional)
 *  - bgImage → পুরো background ছবি URL (optional)
 *  - isActive → শুধু active টি app ঊ show করবে
 * ============================================================
 */
// models/LoginImage.js
const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const loginImageSchema = new mongoose.Schema(
  {
    loginImageId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Login image name is required"],
      trim: true,
      unique: true,
    },
    logo: {
      type: String,
      required: false, // Updated to false
    },
    image: {
      type: String,
      required: false, // Updated to false
    },
    bgImage: {
      type: String,
      required: false, // Updated to false
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

loginImageSchema.pre("save", async function (next) {
  if (this.isNew) {
    this.loginImageId = await generateCustomId(
      "LGI",
      mongoose.model("LoginImage"),
      "loginImageId",
      "LoginImage",
    );
  }
  next();
});

module.exports = mongoose.model("LoginImage", loginImageSchema);
