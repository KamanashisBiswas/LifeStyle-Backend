/**
 * ============================================================
 * controllers/headerController.js — Website Header Text Management
 * ============================================================
 * Website ঊর top header ঊ announcement/offer text এবং company name manage করে।
 * System ঊ শুধু একটি header থাকতে পারবে — একরিডান্ট create block করা হয়েছে।
 *
 * API Endpoints:
 *  POST   /api/header        → createHeader()  — নতুন header (প্রথমটি তৈরি করা যায়)
 *  GET    /api/header        → getHeader()     — একমাত্র header
 *  GET    /api/header/all    → getAllHeaders()  — সব headers
 *  PUT    /api/header/:id    → updateHeader()  — update
 *  DELETE /api/header/:id    → deleteHeader()  — delete
 * ============================================================
 */

const Header = require("../models/Header");
const Counter = require("../models/Counter");
const asyncHandler = require("../utils/asyncHandler");

// Create Header (only one allowed)
const createHeader = asyncHandler(async (req, res) => {
  const exists = await Header.findOne();
  if (exists)
    return res
      .status(400)
      .json({ success: false, message: "Header already exists" });

  const count = await Header.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Header" },
    { seq: count + 1 },
    { upsert: true },
  );
  const headerId = `HDR-${String(count + 1).padStart(5, "0")}`;
  const header = await Header.create({
    headerId,
    offerText: req.body.offerText,
    companyName: req.body.companyName,
    createdBy: req.user.id,
  });

  // Populate createdBy before sending response
  const populatedHeader = await Header.findById(header._id).populate(
    "createdBy",
    "name email",
  );
  res.status(201).json({ success: true, data: populatedHeader });
});

// Get Header (only one)
const getHeader = asyncHandler(async (req, res) => {
  const header = await Header.findOne().populate("createdBy", "name email");
  res.status(200).json({ success: true, data: header });
});

// Get All Headers
const getAllHeaders = asyncHandler(async (req, res) => {
  const headers = await Header.find().populate("createdBy", "name email");
  res.status(200).json({ success: true, data: headers });
});

// Update Header
const updateHeader = asyncHandler(async (req, res) => {
  const header = await Header.findOne({ headerId: req.params.id });
  if (!header)
    return res
      .status(404)
      .json({ success: false, message: "Header not found" });

  header.offerText = req.body.offerText;
  header.companyName = req.body.companyName;
  await header.save();

  // Populate createdBy before sending response
  const populatedHeader = await Header.findById(header._id).populate(
    "createdBy",
    "name email",
  );
  res.status(200).json({ success: true, data: populatedHeader });
});

// Delete Header
const deleteHeader = asyncHandler(async (req, res) => {
  const header = await Header.findOneAndDelete({ headerId: req.params.id });
  if (!header)
    return res
      .status(404)
      .json({ success: false, message: "Header not found" });

  const count = await Header.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Header" },
    { seq: count },
    { upsert: true },
  );
  res
    .status(200)
    .json({ success: true, message: "Header deleted successfully" });
});

module.exports = {
  createHeader,
  getHeader,
  getAllHeaders,
  updateHeader,
  deleteHeader,
};
