/**
 * ============================================================
 * controllers/vendorController.js — Vendor/Supplier Management
 * ============================================================
 * Product supplier (vendor) তৈরি, দেখা, update, delete handle করে।
 *
 * API Endpoints:
 *  POST   /api/vendor        → createVendor()    — নতুন vendor তৈরি
 *  GET    /api/vendor        → getAllVendors()    — সব vendors (সার্চ, filter, pagination)
 *  GET    /api/vendor/:id    → getVendorById()   — একটি vendor
 *  PUT    /api/vendor/:id    → updateVendor()    — update
 *  DELETE /api/vendor/:id    → deleteVendor()    — delete (admin only)
 *
 * বিশেষ:
 *  isActive ফিল্তার দিয়ে শুধু active vendor বা সব vendor দেখা যায়
 *  search দিয়ে name ও phone ঊর মধ্যে খোঁজা যায়
 * ============================================================
 */

const Vendor = require("../models/Vendor");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");

// Create Vendor
const createVendor = asyncHandler(async (req, res) => {
  const { name, phone, address, isActive } = req.body;

  const vendor = await Vendor.create({
    name,
    phone,
    address,
    isActive: isActive || false,
    createdBy: req.user.id, // Add creator's ID
  });

  logActivity({
    req,
    action: "CREATE_VENDOR",
    entityType: "Vendor",
    entityId: vendor.vendorId || vendor._id,
    description: `Created new vendor: ${vendor.name}`,
    metadata: { vendorId: vendor.vendorId, name: vendor.name, phone: vendor.phone }
  });

  res.status(201).json({
    success: true,
    message: "Vendor created successfully",
    data: vendor,
  });
});

// Get All Vendors
const getAllVendors = asyncHandler(async (req, res) => {
  const {
    isActive,
    search,
    q,
    _id,
    page = 1,
    limit = 10,
    sortBy = "updatedAt",
    order = "desc",
    pagination,
  } = req.query;

  const filter = {};
  if (_id) filter._id = _id;
  if (isActive === "true" || isActive === true) filter.isActive = true;
  else if (isActive === "false" || isActive === false) filter.isActive = false;

  const searchVal = search || q;
  if (searchVal && searchVal.trim()) {
    const regex = new RegExp(searchVal.trim(), "i");
    filter.$or = [
      { name: regex },
      { phone: regex },
      { address: regex },
      { vendorId: regex },
    ];
  }

  const sortOrder = order === "asc" ? 1 : -1;

  let vendors;
  let total;

  if (pagination === "false") {
    vendors = await Vendor.find(filter)
      .populate("createdBy", "name") // Populate creator's name
      .sort({ [sortBy]: sortOrder });
    total = vendors.length;

    const [activeCount, inactiveCount] = await Promise.all([
      Vendor.countDocuments({ isActive: true }),
      Vendor.countDocuments({ isActive: false }),
    ]);

    const stats = {
      total,
      activeCount,
      inactiveCount,
    };

    return res.status(200).json({
      success: true,
      data: vendors,
      stats,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [vendorsList, totalCount, activeCount, inactiveCount] = await Promise.all([
    Vendor.find(filter)
      .populate("createdBy", "name") // Populate creator's name
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limitNum),
    Vendor.countDocuments(filter),
    Vendor.countDocuments({ isActive: true }),
    Vendor.countDocuments({ isActive: false }),
  ]);

  const stats = {
    total: totalCount,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({
    success: true,
    data: vendorsList,
    stats,
    pagination: {
      total: totalCount,
      totalItems: totalCount,
      page: pageNum,
      currentPage: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
    },
  });
});

// Get Vendor by ID
const getVendorById = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ vendorId: req.params.id }).populate(
    "createdBy",
    "name email",
  ); // Populate creator's details

  if (!vendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }
  res.status(200).json({ success: true, data: vendor });
});

// Update Vendor
const updateVendor = asyncHandler(async (req, res) => {
  const existingVendor = await Vendor.findOne({ vendorId: req.params.id });
  if (!existingVendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  const origName = existingVendor.name;
  const origPhone = existingVendor.phone;
  const origAddress = existingVendor.address;
  const origStatus = existingVendor.isActive;

  const vendor = await Vendor.findOneAndUpdate(
    { vendorId: req.params.id },
    req.body,
    { new: true, runValidators: true },
  );

  const vendorChanges = [];
  if (req.body.name !== undefined && req.body.name !== origName) vendorChanges.push("name");
  if (req.body.phone !== undefined && req.body.phone !== origPhone) vendorChanges.push("phone");
  if (req.body.address !== undefined && req.body.address !== origAddress) vendorChanges.push("address");
  if (req.body.isActive !== undefined && Boolean(req.body.isActive) !== origStatus) vendorChanges.push("status");
  const vendorSummary = vendorChanges.length > 0 ? ` (${vendorChanges.join(", ")})` : "";

  logActivity({
    req,
    action: "UPDATE_VENDOR",
    entityType: "Vendor",
    entityId: vendor.vendorId || vendor._id,
    description: `Updated vendor '${vendor.name}'${vendorSummary}`,
    oldValues: { name: origName, phone: origPhone, address: origAddress, isActive: origStatus },
    newValues: { name: vendor.name, phone: vendor.phone, address: vendor.address, isActive: vendor.isActive },
    metadata: { vendorId: vendor.vendorId, name: vendor.name, updatedFields: vendorChanges }
  });

  res.status(200).json({
    success: true,
    message: "Vendor updated successfully",
    data: vendor,
  });
});

// Delete Vendor
const deleteVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOneAndDelete({ vendorId: req.params.id });
  if (!vendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  logActivity({
    req,
    action: "DELETE_VENDOR",
    entityType: "Vendor",
    entityId: vendor.vendorId || vendor._id,
    description: `Deleted vendor: ${vendor.name}`,
    metadata: { vendorId: vendor.vendorId, name: vendor.name }
  });

  res
    .status(200)
    .json({ success: true, message: "Vendor deleted successfully" });
});

// Toggle Vendor Status
const toggleVendorStatus = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ vendorId: req.params.id });
  if (!vendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  vendor.isActive = !vendor.isActive;
  await vendor.save();

  res.status(200).json({
    success: true,
    message: `Vendor status changed to ${
      vendor.isActive ? "active" : "inactive"
    }`,
    data: vendor,
  });
});

module.exports = {
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  toggleVendorStatus,
};
