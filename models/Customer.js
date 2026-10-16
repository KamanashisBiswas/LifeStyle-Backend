/**
 * ============================================================
 * models/Customer.js — Customer User Model
 * ============================================================
 * এই model Customer website এ register করা customers এর data সাভ করে।
 *
 * গুরুত্বপূর্ণ বিষয়:
 *  - customId → স্বয়ংক্রিয়ভাবে generate হয় (CUS-00001 format)
 *  - phone → unique, Bangladesh number validate করা হয় OTP দিয়ে registration ঎
 *  - email → optional, কিন্তু দিলে unique হতে হবে (partial index ব্যবহার)
 *  - password সরাসরি save হয় না, bcrypt hash ব্যবহার হয়
 *  - addresses → multiple shipping/billing address সাভ করা যায়
 *  - rewardPoints → কেনাকাটার সাথে পয়েন্ট জমিত হয় (ভবিষ্যতে discount এ ব্যবহার)
 *  - matchPassword() → login ঎ password verify করতে
 * ============================================================
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const addressSchema = new mongoose.Schema({
  addressType: {
    type: String,
    enum: ["shipping", "billing"],
    required: true,
  },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zip: { type: String, required: true },
  country: { type: String, required: true, default: "Bangladesh" },
  isDefault: {
    type: Boolean,
    default: false,
  },
});

const customerSchema = new mongoose.Schema(
  {
    customId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: (v) => (v === "" || !v ? undefined : v),
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please fill a valid email address",
      ],
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      select: false, // Do not return password by default
    },
    dob: {
      type: Date,
    },
    addresses: [addressSchema],
    rewardPoints: {
      type: Number,
      default: 0,
    },
    isVip: {
      type: Boolean,
      default: false,
    },
    registeredFrom: {
      type: String,
      enum: ["website", "pos"],
      default: "website",
    },
  },
  { timestamps: true },
);

// Index for email uniqueness only when it's a non-empty string
customerSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } },
);

// Composite unique index on name + phone
customerSchema.index(
  { name: 1, phone: 1 },
  { unique: true }
);

// Combined pre-save hook for custom ID generation and password hashing
customerSchema.pre("save", async function (next) {
  // Generate custom ID only for new documents
  if (this.isNew) {
    try {
      const { generateCustomId } = require("../utils/customIdGenerator");
      this.customId = await generateCustomId(
        "CUS",
        mongoose.model("Customer"),
        "customId",
        "Customer",
      );
    } catch (error) {
      return next(error);
    }
  }

  // Hash password only if it has been modified (or is new) and is not empty / 'N/A'
  if (this.password && this.password !== "N/A" && this.isModified("password")) {
    try {
      this.password = await bcrypt.hash(this.password, 10);
    } catch (error) {
      return next(error);
    }
  }

  next();
});

// Password match method
customerSchema.methods.matchPassword = async function (enteredPassword) {
  // We need to fetch the user with the password field to compare
  const customerWithPassword = await mongoose
    .model("Customer")
    .findById(this._id)
    .select("+password");

  if (!customerWithPassword) {
    return false;
  }

  return await bcrypt.compare(enteredPassword, customerWithPassword.password);
};

module.exports = mongoose.model("Customer", customerSchema);
