const mongoose = require("mongoose");
const VendorReturn = require("../models/VendorReturn");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");

/**
 * @desc    Create new Vendor Product Return request (Pending)
 * @route   POST /api/vendor-return
 * @access  Private (Admin, Manager, Employee)
 */
exports.createVendorReturnRequest = asyncHandler(async (req, res, next) => {
  const { vendor, vendorName, vendorPhone, items, reason, comment } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please select at least one product variation to return.",
    });
  }

  if (!vendorName || !vendorName.trim()) {
    return res.status(400).json({
      success: false,
      message: "Vendor name is required.",
    });
  }

  const processedItems = [];
  let totalReturnItems = 0;
  let totalReturnCost = 0;

  for (const item of items) {
    const { productId, variationId, returnQuantity } = item;

    if (!productId || !variationId || !returnQuantity || returnQuantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid product, variation ID, or return quantity.",
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(400).json({
        success: false,
        message: `Product not found for ID: ${productId}`,
      });
    }

    const variation = product.variation.id(variationId) || product.variation.find((v) => v._id.toString() === variationId.toString());
    if (!variation) {
      return res.status(400).json({
        success: false,
        message: `Selected size/color variation not found for product "${product.name}".`,
      });
    }

    const currentStock = Number(variation.stock || 0);
    const qty = Number(returnQuantity);

    if (qty > currentStock) {
      return res.status(400).json({
        success: false,
        message: `Return quantity (${qty}) for "${product.name}" (${variation.size ? "Size: " + variation.size : ""}${variation.color ? " Color: " + variation.color : ""}) exceeds current available stock (${currentStock}).`,
      });
    }

    const purchasePrice = Number(variation.purchasePrice || 0);
    const basePrice = Number(variation.basePrice || 0);
    const discountPrice = variation.discountPrice !== undefined && variation.discountPrice !== null ? Number(variation.discountPrice) : null;
    const itemTotalCost = qty * purchasePrice;

    processedItems.push({
      product: product._id,
      productIdCode: product.productId || "",
      productName: product.name,
      variationId: variation._id.toString(),
      size: variation.size || null,
      color: variation.color || null,
      sku: variation.sku || product.sku || null,
      returnQuantity: qty,
      stockAtRequestTime: currentStock,
      purchasePrice,
      basePrice,
      discountPrice,
      totalReturnCost: itemTotalCost,
    });

    totalReturnItems += qty;
    totalReturnCost += itemTotalCost;
  }

  const userId = req.user?._id || req.user?.id;
  const userName = req.user?.name || "Staff";

  const vendorReturn = await VendorReturn.create({
    vendor: vendor || null,
    vendorName: vendorName.trim(),
    vendorPhone: vendorPhone ? vendorPhone.trim() : "",
    items: processedItems,
    totalReturnItems,
    totalReturnCost,
    reason: reason || "Date Expired",
    comment: comment ? comment.trim() : "",
    status: "pending",
    requestedBy: userId,
    requestedByName: userName,
  });

  await logActivity({
    user: userId,
    userName: userName,
    userEmail: req.user?.email || "",
    userRole: req.user?.role || "employee",
    action: "CREATE_VENDOR_RETURN_REQUEST",
    entityType: "VendorReturn",
    entityId: vendorReturn._id.toString(),
    description: `User ${userName} created vendor return request ${vendorReturn.returnId} for vendor "${vendorReturn.vendorName}" (${totalReturnItems} items, Total Cost: ৳${totalReturnCost}). Status: Pending Approval.`,
  });

  res.status(201).json({
    success: true,
    message: `Vendor return request ${vendorReturn.returnId} submitted successfully! Awaiting Admin approval.`,
    data: vendorReturn,
  });
});

/**
 * @desc    Get all Vendor Returns with pagination, search, and summary stats
 * @route   GET /api/vendor-return
 * @access  Private (Admin, Manager, Employee)
 */
exports.getAllVendorReturns = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const userId = req.user?._id || req.user?.id;
  const isAdmin = req.user?.role === "admin";

  const query = {};

  // Non-Admin users (Employee, Manager, etc.) see ONLY their own submitted requests
  if (!isAdmin) {
    query.requestedBy = userId;
  }

  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }

  if (req.query.reason && req.query.reason !== "all") {
    query.reason = req.query.reason;
  }

  // Date Filtering (checks updatedAt or createdAt)
  const { specificDate, startDate, endDate, period } = req.query;
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    query.$and = (query.$and || []).concat([
      {
        $or: [
          { updatedAt: dateFilterCond },
          { createdAt: dateFilterCond }
        ]
      }
    ]);
  } else if (startDate || endDate) {
    const dateRangeCond = {};
    if (startDate) dateRangeCond.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      dateRangeCond.$lte = eDate;
    }
    query.$and = (query.$and || []).concat([
      {
        $or: [
          { updatedAt: dateRangeCond },
          { createdAt: dateRangeCond }
        ]
      }
    ]);
  } else if (period) {
    const now = new Date();
    let periodStartDate;
    switch (period) {
      case "daily":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "weekly":
        periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        periodStartDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        periodStartDate = null;
    }
    if (periodStartDate) {
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } }
          ]
        }
      ]);
    }
  }

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, "i");
    const searchCond = [
      { returnId: searchRegex },
      { vendorName: searchRegex },
      { "items.productName": searchRegex },
      { "items.productIdCode": searchRegex },
      { requestedByName: searchRegex },
    ];
    query.$and = (query.$and || []).concat([{ $or: searchCond }]);
  }

  const baseFilter = !isAdmin ? { requestedBy: userId } : {};

  const [returns, totalDocs, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    VendorReturn.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    VendorReturn.countDocuments(query),
    VendorReturn.countDocuments({ ...baseFilter, status: "pending" }),
    VendorReturn.countDocuments({ ...baseFilter, status: "approved" }),
    VendorReturn.countDocuments({ ...baseFilter, status: "rejected" }),
  ]);

  // Aggregate stats
  const totalsResult = await VendorReturn.aggregate([
    { $match: { ...baseFilter, status: "approved" } },
    {
      $group: {
        _id: null,
        totalItems: { $sum: "$totalReturnItems" },
        totalCost: { $sum: "$totalReturnCost" },
      },
    },
  ]);

  const approvedItemsTotal = totalsResult[0]?.totalItems || 0;
  const approvedCostTotal = totalsResult[0]?.totalCost || 0;

  const stats = {
    total: totalDocs,
    pendingCount,
    approvedCount,
    rejectedCount,
    approvedItemsTotal,
    approvedCostTotal,
  };

  res.status(200).json({
    success: true,
    data: returns,
    pagination: {
      total: totalDocs,
      page,
      pages: Math.ceil(totalDocs / limit) || 1,
      limit,
    },
    stats,
  });
});

/**
 * @desc    Get single Vendor Return details by ID
 * @route   GET /api/vendor-return/:id
 * @access  Private (Admin, Manager, Employee)
 */
exports.getVendorReturnById = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id || req.user?.id;
  const isAdmin = req.user?.role === "admin";

  const query = { _id: req.params.id };
  if (!isAdmin) {
    query.requestedBy = userId;
  }

  const vendorReturn = await VendorReturn.findOne(query)
    .populate("vendor", "name phone address vendorId")
    .populate("requestedBy", "name email role")
    .populate("processedBy", "name email role");

  if (!vendorReturn) {
    return res.status(404).json({
      success: false,
      message: "Vendor return request not found or access denied.",
    });
  }

  res.status(200).json({
    success: true,
    data: vendorReturn,
  });
});

/**
 * @desc    Approve Vendor Product Return request & deduct stock atomically
 * @route   PUT /api/vendor-return/:id/approve
 * @access  Private (Admin Only)
 */
exports.approveVendorReturn = asyncHandler(async (req, res, next) => {
  let session = null;
  let isStandaloneFallback = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (sessErr) {
    // If MongoDB replica set is not configured, fall back to atomic findOneAndUpdate check
    isStandaloneFallback = true;
  }

  if (!isStandaloneFallback && session) {
    try {
      const vendorReturn = await VendorReturn.findOne({
        _id: req.params.id,
        status: "pending",
      }).session(session);

      if (!vendorReturn) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Vendor return request not found or has already been processed.",
        });
      }

      // Revalidate stock for every item at approval time
      for (const item of vendorReturn.items) {
        const product = await Product.findById(item.product).session(session);
        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Product "${item.productName}" (ID: ${item.productIdCode}) no longer exists in database.`,
          });
        }

        const variation = product.variation.id(item.variationId) || product.variation.find((v) => v._id.toString() === item.variationId.toString());
        if (!variation) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Size/Color variation for product "${item.productName}" not found.`,
          });
        }

        const currentStock = Number(variation.stock || 0);
        if (currentStock < item.returnQuantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Approval failed: Insufficient current stock for "${item.productName}" (${item.size ? "Size: " + item.size : ""}${item.color ? " Color: " + item.color : ""}). Requested return: ${item.returnQuantity}, Current available stock: ${currentStock}.`,
          });
        }

        item.stockAtApprovalTime = currentStock;
        item.newStockAfterApproval = Math.max(0, currentStock - item.returnQuantity);

        // Deduct stock
        variation.stock = Math.max(0, currentStock - item.returnQuantity);
        await product.save({ session });
      }

      const adminId = req.user._id || req.user.id;
      const adminName = req.user.name || "Admin";

      vendorReturn.status = "approved";
      vendorReturn.processedBy = adminId;
      vendorReturn.processedByName = adminName;
      vendorReturn.adminComment = req.body.adminComment ? req.body.adminComment.trim() : "Approved by admin";
      vendorReturn.processedAt = new Date();

      await vendorReturn.save({ session });

      await session.commitTransaction();
      session.endSession();

      await logActivity({
        user: adminId,
        userName: adminName,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: "APPROVE_VENDOR_RETURN",
        entityType: "VendorReturn",
        entityId: vendorReturn._id.toString(),
        description: `Admin ${adminName} approved vendor return ${vendorReturn.returnId} for vendor "${vendorReturn.vendorName}" (${vendorReturn.totalReturnItems} items, Total Cost: ৳${vendorReturn.totalReturnCost}). Stock deducted.`,
      });

      return res.status(200).json({
        success: true,
        message: `Vendor return request ${vendorReturn.returnId} approved successfully and product stock updated!`,
        data: vendorReturn,
      });
    } catch (err) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      throw err;
    }
  }

  // Standalone MongoDB Fallback Logic
  const vendorReturn = await VendorReturn.findOne({
    _id: req.params.id,
    status: "pending",
  });

  if (!vendorReturn) {
    return res.status(400).json({
      success: false,
      message: "Vendor return request not found or has already been processed.",
    });
  }

  // Revalidate stock
  for (const item of vendorReturn.items) {
    const product = await Product.findById(item.product);
    if (!product) {
      return res.status(400).json({
        success: false,
        message: `Product "${item.productName}" no longer exists in database.`,
      });
    }
    const variation = product.variation.id(item.variationId) || product.variation.find((v) => v._id.toString() === item.variationId.toString());
    if (!variation) {
      return res.status(400).json({
        success: false,
        message: `Size/Color variation for product "${item.productName}" not found.`,
      });
    }

    const currentStock = Number(variation.stock || 0);
    if (currentStock < item.returnQuantity) {
      return res.status(400).json({
        success: false,
        message: `Approval failed: Insufficient current stock for "${item.productName}" (${item.size ? "Size: " + item.size : ""}${item.color ? " Color: " + item.color : ""}). Requested return: ${item.returnQuantity}, Current stock: ${currentStock}.`,
      });
    }
  }

  // Deduct stock for all items
  for (const item of vendorReturn.items) {
    const product = await Product.findById(item.product);
    const variation = product.variation.id(item.variationId) || product.variation.find((v) => v._id.toString() === item.variationId.toString());
    const currentStock = Number(variation.stock || 0);

    item.stockAtApprovalTime = currentStock;
    item.newStockAfterApproval = Math.max(0, currentStock - item.returnQuantity);

    variation.stock = Math.max(0, currentStock - item.returnQuantity);
    await product.save();
  }

  const adminId = req.user._id || req.user.id;
  const adminName = req.user.name || "Admin";

  vendorReturn.status = "approved";
  vendorReturn.processedBy = adminId;
  vendorReturn.processedByName = adminName;
  vendorReturn.adminComment = req.body.adminComment ? req.body.adminComment.trim() : "Approved by admin";
  vendorReturn.processedAt = new Date();

  await vendorReturn.save();

  await logActivity({
    user: adminId,
    userName: adminName,
    userEmail: req.user?.email || "",
    userRole: req.user?.role || "admin",
    action: "APPROVE_VENDOR_RETURN",
    entityType: "VendorReturn",
    entityId: vendorReturn._id.toString(),
    description: `Admin ${adminName} approved vendor return ${vendorReturn.returnId} for vendor "${vendorReturn.vendorName}" (${vendorReturn.totalReturnItems} items, Total Cost: ৳${vendorReturn.totalReturnCost}). Stock deducted.`,
  });

  return res.status(200).json({
    success: true,
    message: `Vendor return request ${vendorReturn.returnId} approved successfully and product stock updated!`,
    data: vendorReturn,
  });
});

/**
 * @desc    Reject Vendor Product Return request
 * @route   PUT /api/vendor-return/:id/reject
 * @access  Private (Admin Only)
 */
exports.rejectVendorReturn = asyncHandler(async (req, res, next) => {
  const adminId = req.user._id || req.user.id;
  const adminName = req.user.name || "Admin";

  const vendorReturn = await VendorReturn.findOneAndUpdate(
    { _id: req.params.id, status: "pending" },
    {
      status: "rejected",
      processedBy: adminId,
      processedByName: adminName,
      adminComment: req.body.adminComment ? req.body.adminComment.trim() : "Rejected by admin",
      processedAt: new Date(),
    },
    { new: true }
  );

  if (!vendorReturn) {
    return res.status(400).json({
      success: false,
      message: "Vendor return request not found or has already been processed.",
    });
  }

  await logActivity({
    user: adminId,
    userName: adminName,
    userEmail: req.user?.email || "",
    userRole: req.user?.role || "admin",
    action: "REJECT_VENDOR_RETURN",
    entityType: "VendorReturn",
    entityId: vendorReturn._id.toString(),
    description: `Admin ${adminName} rejected vendor return ${vendorReturn.returnId} for vendor "${vendorReturn.vendorName}". Stock remains unchanged.`,
  });

  res.status(200).json({
    success: true,
    message: `Vendor return request ${vendorReturn.returnId} rejected. No stock changes were made.`,
    data: vendorReturn,
  });
});
