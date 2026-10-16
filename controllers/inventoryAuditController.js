/**
 * ============================================================
 * controllers/inventoryAuditController.js — Inventory Physical Audit
 * ============================================================
 * দোকানে ফিজিক্যাল ইনভেন্টরি অডিট, বারকোড/SKU স্ক্যানিং ও
 * অডিট রিপোর্ট তৈরি এবং হিস্ট্রি সংরক্ষণের কন্ট্রোলার।
 *
 * নীতি: এটি প্রডাক্টের মূল লাইভ স্টকে কোনো পরিবর্তন করে না।
 * ============================================================
 */

const asyncHandler = require("../utils/asyncHandler");
const Product = require("../models/Product");
const InventoryAudit = require("../models/InventoryAudit");

/**
 * @desc    Scan SKU / Barcode for Inventory Check
 * @route   POST /api/inventory-audit/scan
 * @access  Private (Admin, Manager, Employee)
 */
const scanSkuForAudit = asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code || !String(code).trim()) {
    return res.status(400).json({
      success: false,
      message: "Scanned code or SKU is required",
    });
  }

  const searchValue = String(code).trim();
  const sLower = searchValue.toLowerCase();

  // Find product by barcode, productId, top-level SKU, or variation SKU
  const product = await Product.findOne({
    $or: [
      { barcode: searchValue },
      { productId: searchValue },
      { sku: searchValue },
      { "variation.sku": searchValue },
      { "variation.size": searchValue },
    ],
    isActive: true,
  }).select("productId sku barcode name bannerImage variation");

  if (!product) {
    return res.status(404).json({
      success: false,
      message: `No active product found for code: "${searchValue}"`,
    });
  }

  // Find matched variation
  let selectedVariation = null;
  if (Array.isArray(product.variation) && product.variation.length > 0) {
    selectedVariation = product.variation.find(
      (v) =>
        (v.sku && String(v.sku).trim().toLowerCase() === sLower) ||
        (v.size && String(v.size).trim().toLowerCase() === sLower) ||
        (v._id && String(v._id) === searchValue)
    );

    // Fallback: if only one variation exists
    if (!selectedVariation && product.variation.length === 1) {
      selectedVariation = product.variation[0];
    }
  }

  // Determine system stock
  const systemStock = selectedVariation
    ? Number(selectedVariation.stock || 0)
    : product.variation && product.variation.length > 0
    ? product.variation.reduce((acc, v) => acc + Number(v.stock || 0), 0)
    : 0;

  const skuCode =
    selectedVariation?.sku ||
    product.sku ||
    product.barcode ||
    product.productId;

  const responseItem = {
    productId: product._id,
    customId: product.productId,
    productName: product.name,
    variationId: selectedVariation?._id || null,
    sku: skuCode,
    size: selectedVariation?.size || "Regular",
    color: selectedVariation?.color || "",
    image:
      (selectedVariation?.images && selectedVariation.images[0]) ||
      product.bannerImage ||
      "",
    systemStock,
  };

  res.status(200).json({
    success: true,
    item: responseItem,
  });
});

/**
 * @desc    Save Inventory Physical Audit Session
 * @route   POST /api/inventory-audit
 * @access  Private (Admin, Manager, Employee)
 */
const saveAuditSession = asyncHandler(async (req, res) => {
  const { items, note } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one product item must be scanned to save an audit.",
    });
  }

  let totalSystemStock = 0;
  let totalScannedCount = 0;
  let totalMissingCount = 0;
  let totalExtraCount = 0;
  let totalMatchedItems = 0;

  const formattedItems = items.map((item) => {
    const sysStock = Number(item.systemStock || 0);
    const scCount = Number(item.scannedCount || 0);
    const discrepancy = scCount - sysStock;

    let status = "matched";
    if (discrepancy < 0) {
      status = "missing";
      totalMissingCount += Math.abs(discrepancy);
    } else if (discrepancy > 0) {
      status = "extra";
      totalExtraCount += discrepancy;
    } else {
      totalMatchedItems += 1;
    }

    totalSystemStock += sysStock;
    totalScannedCount += scCount;

    return {
      productId: item.productId || null,
      customId: item.customId || "",
      productName: item.productName || "Unknown Product",
      variationId: item.variationId || null,
      sku: item.sku || "",
      size: item.size || "",
      color: item.color || "",
      image: item.image || "",
      systemStock: sysStock,
      scannedCount: scCount,
      discrepancy,
      status,
    };
  });

  // Compute total store stock across all products in database at this exact moment
  const totalStockResult = await Product.aggregate([
    { $unwind: { path: "$variation", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalStock: { $sum: { $ifNull: ["$variation.stock", 0] } },
      },
    },
  ]);
  const totalStoreStock = totalStockResult[0]?.totalStock || 0;

  const audit = await InventoryAudit.create({
    auditedBy: req.user._id,
    auditorName: req.user.name || "Staff",
    auditorRole: req.user.role || "employee",
    note: note ? String(note).trim() : "",
    totalStoreStock,
    totalSystemStock,
    totalScannedCount,
    totalMissingCount,
    totalExtraCount,
    totalMatchedItems,
    items: formattedItems,
  });

  res.status(201).json({
    success: true,
    message: "Inventory audit saved successfully.",
    audit,
  });
});

/**
 * @desc    Get All Audit Sessions (Paginated)
 * @route   GET /api/inventory-audit
 * @access  Private (Admin, Manager, Employee)
 */
const getAllAuditSessions = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = {};

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search.trim(), "i");
    query.$or = [
      { auditId: searchRegex },
      { auditorName: searchRegex },
      { note: searchRegex },
      { "items.productName": searchRegex },
      { "items.sku": searchRegex },
    ];
  }

  const [audits, total, statsAgg] = await Promise.all([
    InventoryAudit.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("auditedBy", "name role email phone")
      .lean(),
    InventoryAudit.countDocuments(query),
    InventoryAudit.aggregate([
      {
        $group: {
          _id: null,
          totalAudits: { $sum: 1 },
          totalScannedUnits: { $sum: "$totalScannedCount" },
          totalMissingUnits: { $sum: "$totalMissingCount" },
          totalMatchedItems: { $sum: "$totalMatchedItems" },
        },
      },
    ]),
  ]);

  const stats = {
    totalAudits: total,
    totalScannedUnits: statsAgg[0]?.totalScannedUnits || 0,
    totalMissingUnits: statsAgg[0]?.totalMissingUnits || 0,
    totalMatchedItems: statsAgg[0]?.totalMatchedItems || 0,
  };

  res.status(200).json({
    success: true,
    data: audits,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      limit,
    },
    stats,
  });
});

/**
 * @desc    Get Audit Session Details with all items
 * @route   GET /api/inventory-audit/:id
 * @access  Private (Admin, Manager, Employee)
 */
const getAuditSessionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let audit;
  if (id.startsWith("AUD-")) {
    audit = await InventoryAudit.findOne({ auditId: id }).populate(
      "auditedBy",
      "name role email phone"
    );
  } else {
    audit = await InventoryAudit.findById(id).populate(
      "auditedBy",
      "name role email phone"
    );
  }

  if (!audit) {
    return res.status(404).json({
      success: false,
      message: "Audit session not found",
    });
  }

  res.status(200).json({
    success: true,
    data: audit,
  });
});

/**
 * @desc    Delete an audit session
 * @route   DELETE /api/inventory-audit/:id
 * @access  Private (Admin only)
 */
const deleteAuditSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const audit = await InventoryAudit.findById(id);
  if (!audit) {
    return res.status(404).json({
      success: false,
      message: "Audit session not found",
    });
  }

  await InventoryAudit.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: "Audit session deleted successfully",
  });
});

/**
 * @desc    Get total store stock across entire database
 * @route   GET /api/inventory-audit/db-stock
 * @access  Private (Admin, Manager, Employee)
 */
const getDatabaseTotalStock = asyncHandler(async (req, res) => {
  const result = await Product.aggregate([
    { $unwind: { path: "$variation", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalStock: { $sum: { $ifNull: ["$variation.stock", 0] } },
        totalProducts: { $addToSet: "$_id" },
      },
    },
    {
      $project: {
        totalStock: 1,
        totalProductsCount: { $size: "$totalProducts" },
      },
    },
  ]);

  const totalStock = result[0]?.totalStock || 0;
  const totalProducts = result[0]?.totalProductsCount || 0;

  res.status(200).json({
    success: true,
    totalStock,
    totalProducts,
  });
});

module.exports = {
  scanSkuForAudit,
  saveAuditSession,
  getAllAuditSessions,
  getAuditSessionById,
  deleteAuditSession,
  getDatabaseTotalStock,
};
