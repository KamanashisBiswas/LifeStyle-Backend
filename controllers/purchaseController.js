/**
 * ============================================================
 * controllers/purchaseController.js — Stock Purchase Controller
 * ============================================================
 * পণ্য ক্রয় ও স্টক সংযোজনের লজিক।
 *  - createPurchase: ক্রয়ের রিকোয়েস্ট তৈরি করে (Status: pending). প্রোডাক্ট স্টক আপডেট হয় না।
 *  - approvePurchase: Admin কর্তৃক রিকোয়েস্ট অ্যাপ্রুভ করা হলে প্রোডাক্ট স্টক স্বয়ংক্রিয়ভাবে আপডেট হয়।
 *  - rejectPurchase: Admin বাতিল করলে স্টক পরিবর্তন হয় না।
 *  - getPurchases: ফিল্টারিং ও সার্চসহ ক্রয়ের তালিকা ও সমারী প্রদর্শন।
 * ============================================================
 */

const asyncHandler = require("../utils/asyncHandler");
const Purchase = require("../models/Purchase");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const User = require("../models/User");
const { logActivity } = require("../utils/activityLogger");

// @desc    Create new stock purchase request (Pending Admin Approval)
// @route   POST /api/purchase
// @access  Private (Admin, Manager, Employee)
const createPurchase = asyncHandler(async (req, res) => {
  const {
    productId,
    variationId,
    productSize,
    productColor,
    quantity,
    purchasePrice,
    vendorId,
    invoiceNo,
    purchaseDate,
    notes,
    batchId,
    targetLocation,
  } = req.body;

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Please select a product for purchase",
    });
  }

  const numQty = Number(quantity);
  const numPrice =
    purchasePrice !== undefined && purchasePrice !== null && String(purchasePrice).trim() !== ""
      ? Number(purchasePrice)
      : 0;

  if (!numQty || numQty < 1) {
    return res.status(400).json({
      success: false,
      message: "Purchase quantity must be at least 1",
    });
  }

  if (isNaN(numPrice) || numPrice < 0) {
    return res.status(400).json({
      success: false,
      message: "Purchase price must be 0 or greater",
    });
  }

  // Verify Product exists
  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Selected product not found",
    });
  }

  // Verify Vendor if provided
  let vendorObj = null;
  let vendorName = "";
  if (vendorId) {
    vendorObj = await Vendor.findById(vendorId);
    if (vendorObj) {
      vendorName = vendorObj.name;
    }
  }

  // Get user details
  const createdBy = req.user.id || req.user._id;
  const createdByName = req.user.name || "Staff";
  const createdByRole = req.user.role || "user";

  // Determine variationId if not provided directly
  let targetVariationId = variationId || "";
  if (!targetVariationId && Array.isArray(product.variation) && product.variation.length > 0) {
    let matchedVar = product.variation.find((v) => {
      const vSizeStr = String(v.size || "").trim().toLowerCase();
      const pSizeStr = String(productSize || "").trim().toLowerCase();
      const sizeMatch = !pSizeStr || vSizeStr === pSizeStr;

      const vColorStr = String(v.color || "").trim().toLowerCase();
      const pColorStr = String(productColor || "").trim().toLowerCase();
      const colorMatch = !pColorStr || vColorStr === pColorStr;

      return sizeMatch && colorMatch;
    });

    if (!matchedVar && productSize) {
      matchedVar = product.variation.find(
        (v) => String(v.size || "").trim().toLowerCase() === String(productSize || "").trim().toLowerCase()
      );
    }
    if (!matchedVar && productColor) {
      matchedVar = product.variation.find(
        (v) => String(v.color || "").trim().toLowerCase() === String(productColor || "").trim().toLowerCase()
      );
    }
    if (!matchedVar && product.variation.length > 0) {
      matchedVar = product.variation[0];
    }
    if (matchedVar) {
      targetVariationId = matchedVar._id;
    }
  }

  // All roles (Admin, Manager, Employee) create stock purchase as a "pending" request.
  // Stock is only updated once an Admin reviews and approves the request.
  const purchase = new Purchase({
    product: product._id,
    productName: product.name,
    productIdCode: product.productId || "",
    variationId: targetVariationId,
    productSize: (productSize || "").trim(),
    productColor: (productColor || "").trim(),
    quantity: numQty,
    purchasePrice: numPrice,
    totalCost: numQty * numPrice,
    targetLocation: ["shopStock", "display", "warehouse"].includes(targetLocation)
      ? targetLocation
      : "shopStock",
    vendor: vendorObj ? vendorObj._id : null,
    vendorName: vendorName,
    batchId: (batchId || "").trim(),
    invoiceNo: (invoiceNo || "").trim(),
    purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
    notes: (notes || "").trim(),
    status: "pending",
    createdBy,
    createdByName,
    createdByRole,
  });

  await purchase.save();

  // Log activity
  logActivity({
    req,
    action: "CREATE_PURCHASE",
    entityType: "Purchase",
    entityId: purchase._id,
    description: `Created pending stock purchase for "${product.name}" (${numQty} units at ৳${numPrice}/unit) by ${createdByName} (${createdByRole})`,
    metadata: {
      purchaseId: purchase.purchaseId,
      productName: product.name,
      quantity: numQty,
      totalCost: purchase.totalCost,
    },
  });

  res.status(201).json({
    success: true,
    message: "Stock purchase request submitted successfully (Pending Admin Approval)",
    data: purchase,
  });
});

// @desc    Get all stock purchases with search & filters
// @route   GET /api/purchase
// @access  Private (Admin, Manager, Employee)
const getPurchases = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    vendor,
    startDate,
    endDate,
  } = req.query;

  const query = {};

  // If user is a Manager or requested myOnly=true, filter to their own submitted requests
  if (req.user.role === "manager" || req.user.role === "employee" || req.query.myOnly === "true") {
    query.createdBy = req.user.id || req.user._id;
  }

  // Status Filter
  if (status && ["pending", "approved", "rejected"].includes(status.toLowerCase())) {
    query.status = status.toLowerCase();
  }

  // Vendor Filter
  if (vendor) {
    query.vendor = vendor;
  }

  // Date Range Filter
  if (startDate || endDate) {
    query.purchaseDate = {};
    if (startDate) query.purchaseDate.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      query.purchaseDate.$lte = eDate;
    }
  }

  // Text Search (Supports Product ID, Product Name, Purchase ID, Staff, Invoice, Notes, etc.)
  if (search && search.trim()) {
    const searchTrimmed = search.trim();
    const regex = new RegExp(searchTrimmed, "i");

    // Find matching products by name or productId/customId
    const matchingProducts = await Product.find({
      $or: [
        { name: regex },
        { productId: regex },
        { customId: regex },
      ],
    })
      .select("_id")
      .lean();

    const matchingProductIds = matchingProducts.map((p) => p._id);

    query.$or = [
      { purchaseId: regex },
      { productName: regex },
      { productIdCode: regex },
      { vendorName: regex },
      { createdByName: regex },
      { invoiceNo: regex },
      { notes: regex },
      { productSize: regex },
      { productColor: regex },
      { batchId: regex },
      ...(matchingProductIds.length > 0
        ? [{ product: { $in: matchingProductIds } }]
        : []),
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [rawPurchases, totalCount] = await Promise.all([
    Purchase.find(query)
      .populate({
        path: "product",
        select: "name productId bannerImage images variation vendor",
        populate: { path: "vendor", select: "name phone" },
      })
      .populate("vendor", "name phone address")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Purchase.countDocuments(query),
  ]);

  // Aggregate summary stats
  const [statusCounts, totalCostAgg] = await Promise.all([
    Purchase.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalCost" },
        },
      },
    ]),
    Purchase.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: null, approvedCost: { $sum: "$totalCost" } } },
    ]),
  ]);

  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let grandTotalCost = 0;

  statusCounts.forEach((item) => {
    if (item._id === "pending") pendingCount = item.count;
    if (item._id === "approved") approvedCount = item.count;
    if (item._id === "rejected") rejectedCount = item.count;
    grandTotalCost += item.totalAmount || 0;
  });

  const stats = {
    totalPurchases: totalCount,
    total: totalCount,
    pendingCount,
    approvedCount,
    rejectedCount,
    approvedExpenditure: totalCostAgg[0]?.approvedCost || 0,
    grandTotalCost,
  };

  const groupedPurchases = [];
  const batchMap = new Map();

  for (const item of rawPurchases) {
    let groupKey = item.batchId;
    if (!groupKey) {
      const creatorId = item.createdBy?._id || item.createdBy || "unknown";
      const timeBucket = Math.floor(new Date(item.createdAt || item.purchaseDate).getTime() / 5000);
      groupKey = `batch_${creatorId}_${timeBucket}`;
    }

    if (!batchMap.has(groupKey)) {
      const batchEntry = {
        ...item,
        batchId: item.batchId || groupKey,
        itemCount: 1,
        totalQuantity: Number(item.quantity) || 0,
        totalBatchCost: Number(item.totalCost) || 0,
        batchItems: [item],
      };
      batchMap.set(groupKey, batchEntry);
      groupedPurchases.push(batchEntry);
    } else {
      const existing = batchMap.get(groupKey);
      existing.itemCount += 1;
      existing.totalQuantity += Number(item.quantity) || 0;
      existing.totalBatchCost += Number(item.totalCost) || 0;
      existing.batchItems.push(item);
    }
  }

  // Mask purchase price and total cost for non-admin users (Manager, Employee, etc.)
  if (req.user?.role !== "admin") {
    stats.approvedExpenditure = 0;
    stats.grandTotalCost = 0;
    groupedPurchases.forEach((grp) => {
      grp.totalBatchCost = 0;
      grp.purchasePrice = 0;
      grp.totalCost = 0;
      if (Array.isArray(grp.batchItems)) {
        grp.batchItems.forEach((b) => {
          b.purchasePrice = 0;
          b.totalCost = 0;
        });
      }
    });
  }

  res.status(200).json({
    success: true,
    data: groupedPurchases,
    stats,
    pagination: {
      total: groupedPurchases.length,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(groupedPurchases.length / Number(limit)) || 1,
    },
  });
});

// @desc    Get purchase details by ID
// @route   GET /api/purchase/:id
// @access  Private (Admin, Manager, Employee)
const getPurchaseById = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id)
    .populate("product")
    .populate("vendor")
    .populate("createdBy", "name email role")
    .populate("approvedBy", "name email role")
    .lean();

  let batchItems = [];
  if (purchase.batchId) {
    batchItems = await Purchase.find({ batchId: purchase.batchId })
      .populate("product")
      .populate("vendor")
      .lean();
  } else if (purchase.createdBy && purchase.createdAt) {
    const startTime = new Date(new Date(purchase.createdAt).getTime() - 5000);
    const endTime = new Date(new Date(purchase.createdAt).getTime() + 5000);
    const creatorId = purchase.createdBy._id || purchase.createdBy;
    batchItems = await Purchase.find({
      createdBy: creatorId,
      createdAt: { $gte: startTime, $lte: endTime },
    })
      .populate("product")
      .populate("vendor")
      .lean();
  }

  const enrichItem = (item) => {
    let matchedVar = null;
    if (item.product && Array.isArray(item.product.variation)) {
      if (item.variationId) {
        matchedVar = item.product.variation.find(
          (v) => String(v._id) === String(item.variationId)
        );
      }
      if (!matchedVar) {
        matchedVar = item.product.variation.find((v) => {
          const vSize = String(v.size || "").trim().toLowerCase();
          const pSize = String(item.productSize || "").trim().toLowerCase();
          const vColor = String(v.color || "").trim().toLowerCase();
          const pColor = String(item.productColor || "").trim().toLowerCase();
          return (!pSize || vSize === pSize) && (!pColor || vColor === pColor);
        });
      }
      if (!matchedVar && item.product.variation.length > 0) {
        matchedVar = item.product.variation[0];
      }
    }

    const varPurchasePrice = matchedVar ? Number(matchedVar.purchasePrice) || 0 : 0;
    const varBasePrice = matchedVar ? Number(matchedVar.basePrice) || 0 : 0;
    const varDiscountPrice = matchedVar
      ? matchedVar.discountPrice !== undefined && matchedVar.discountPrice !== null
        ? Number(matchedVar.discountPrice)
        : 0
      : 0;

    return {
      ...item,
      purchasePrice: item.purchasePrice > 0 ? item.purchasePrice : varPurchasePrice,
      basePrice: item.basePrice > 0 ? item.basePrice : varBasePrice,
      discountPrice:
        item.discountPrice !== undefined && item.discountPrice > 0
          ? item.discountPrice
          : varDiscountPrice,
      currentVariationPrice: {
        purchasePrice: varPurchasePrice,
        basePrice: varBasePrice,
        discountPrice: varDiscountPrice,
      },
    };
  };

  const isRequesterAdmin = req.user?.role === "admin";
  const sanitizeForNonAdmin = (item) => {
    if (isRequesterAdmin) return item;
    return {
      ...item,
      purchasePrice: null,
      totalCost: null,
      currentVariationPrice: item.currentVariationPrice
        ? {
            ...item.currentVariationPrice,
            purchasePrice: null,
          }
        : undefined,
    };
  };

  const rawList = batchItems.length > 0 ? batchItems : [purchase];
  const enrichedBatchItems = rawList.map(enrichItem).map(sanitizeForNonAdmin);
  const enrichedPurchase = sanitizeForNonAdmin(enrichItem(purchase));

  res.status(200).json({
    success: true,
    data: {
      ...enrichedPurchase,
      batchItems: enrichedBatchItems,
    },
  });
});

// @desc    Approve stock purchase request & Auto Update Product Stock (Admin Only)
// @route   PUT /api/purchase/:id/approve
// @access  Private (Admin Only)
const approvePurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);

  if (!purchase) {
    return res.status(404).json({
      success: false,
      message: "Stock purchase record not found",
    });
  }

  // Find all pending items in this batch (or single purchase if not a batch)
  let itemsToApprove = [];
  if (purchase.batchId) {
    itemsToApprove = await Purchase.find({
      batchId: purchase.batchId,
      status: "pending",
    });
  }

  if (itemsToApprove.length === 0 && purchase.status === "pending") {
    itemsToApprove = [purchase];
  }

  if (itemsToApprove.length === 0) {
    return res.status(400).json({
      success: false,
      message: `Purchase request is already in '${purchase.status}' status and cannot be re-approved.`,
    });
  }

  let totalAddedUnits = 0;
  const approvedItemIds = [];

  // Check if Admin provided edits for approval (either batch array or single item payload)
  const editedItemsMap = new Map();
  if (Array.isArray(req.body.items)) {
    for (const itemEdit of req.body.items) {
      if (itemEdit && (itemEdit.id || itemEdit._id)) {
        editedItemsMap.set(String(itemEdit.id || itemEdit._id), itemEdit);
      }
    }
  }

  for (const purItem of itemsToApprove) {
    // 0. Apply Admin edits if provided
    const itemEdit =
      editedItemsMap.get(String(purItem._id)) ||
      (itemsToApprove.length === 1 &&
      (req.body.quantity !== undefined ||
        req.body.purchasePrice !== undefined ||
        req.body.basePrice !== undefined ||
        req.body.discountPrice !== undefined ||
        req.body.targetLocation !== undefined ||
        req.body.vendorId !== undefined ||
        req.body.notes !== undefined)
        ? req.body
        : null);

    if (itemEdit) {
      // Requested stock quantity cannot be altered by Admin (manager/staff requested quantity is preserved)
      if (itemEdit.purchasePrice !== undefined && !isNaN(Number(itemEdit.purchasePrice))) {
        purItem.purchasePrice = Math.max(0, Number(itemEdit.purchasePrice));
      }
      if (itemEdit.basePrice !== undefined && !isNaN(Number(itemEdit.basePrice))) {
        purItem.basePrice = Math.max(0, Number(itemEdit.basePrice));
      }
      if (itemEdit.discountPrice !== undefined && !isNaN(Number(itemEdit.discountPrice))) {
        purItem.discountPrice = Math.max(0, Number(itemEdit.discountPrice));
      }
      purItem.totalCost = (Number(purItem.quantity) || 0) * (Number(purItem.purchasePrice) || 0);

      if (
        itemEdit.targetLocation &&
        ["shopStock", "display", "warehouse"].includes(itemEdit.targetLocation)
      ) {
        purItem.targetLocation = itemEdit.targetLocation;
      }

      if (itemEdit.notes !== undefined) {
        purItem.notes = String(itemEdit.notes || "").trim();
      }

      if (itemEdit.vendorId) {
        const vDoc = await Vendor.findById(itemEdit.vendorId);
        if (vDoc) {
          purItem.vendor = vDoc._id;
          purItem.vendorName = vDoc.name;
        }
      }
    }

    const product = await Product.findById(purItem.product);
    if (!product || !Array.isArray(product.variation) || product.variation.length === 0) {
      continue;
    }

    let variation;
    // 1. Try matching by variationId
    if (purItem.variationId) {
      variation = product.variation.find(
        (v) => v._id && v._id.toString() === purItem.variationId.toString()
      );
    }

    // 2. Try matching by size and color
    if (!variation) {
      variation = product.variation.find((v) => {
        const vSizeStr = String(v.size || "").trim().toLowerCase();
        const pSizeStr = String(purItem.productSize || "").trim().toLowerCase();
        const sizeMatch = !pSizeStr || vSizeStr === pSizeStr;

        const vColorStr = String(v.color || "").trim().toLowerCase();
        const pColorStr = String(purItem.productColor || "").trim().toLowerCase();
        const colorMatch = !pColorStr || vColorStr === pColorStr;

        return sizeMatch && colorMatch;
      });
    }

    // 3. Fallback: match size only
    if (!variation && purItem.productSize) {
      variation = product.variation.find(
        (v) => String(v.size || "").trim().toLowerCase() === String(purItem.productSize || "").trim().toLowerCase()
      );
    }

    // 4. Fallback: match color only
    if (!variation && purItem.productColor) {
      variation = product.variation.find(
        (v) => String(v.color || "").trim().toLowerCase() === String(purItem.productColor || "").trim().toLowerCase()
      );
    }

    // 5. Ultimate Fallback: use first variation
    if (!variation && product.variation.length > 0) {
      variation = product.variation[0];
    }

    if (variation) {
      const addedQty = Number(purItem.quantity) || 1;
      const targetLoc = purItem.targetLocation || "shopStock";

      if (!variation.locations) {
        variation.locations = { display: 0, shopStock: 0, warehouse: 0 };
      }

      // Add to specified stock location
      variation.locations[targetLoc] = (Number(variation.locations[targetLoc]) || 0) + addedQty;
      // Add to overall variation stock
      variation.stock = (Number(variation.stock) || 0) + addedQty;

      // Update variation prices on the main product if Admin provided them
      if (purItem.purchasePrice !== undefined && Number(purItem.purchasePrice) >= 0) {
        variation.purchasePrice = Number(purItem.purchasePrice);
      }
      if (purItem.basePrice !== undefined && Number(purItem.basePrice) > 0) {
        variation.basePrice = Number(purItem.basePrice);
      }
      if (purItem.discountPrice !== undefined && Number(purItem.discountPrice) >= 0) {
        variation.discountPrice = Number(purItem.discountPrice);
      }

      product.markModified("variation");
      await product.save();
      totalAddedUnits += addedQty;
    }

    // Update Purchase Status
    purItem.status = "approved";
    purItem.approvedBy = req.user.id || req.user._id;
    purItem.approvedByName = req.user.name || "Admin";
    purItem.approvedAt = new Date();
    await purItem.save();
    approvedItemIds.push(purItem.purchaseId);

    // Log activity
    logActivity({
      req,
      action: "APPROVE_PURCHASE",
      entityType: "Purchase",
      entityId: purItem._id,
      description: `Approved stock purchase "${purItem.purchaseId}" for "${product.name}". +${purItem.quantity} units added to ${purItem.targetLocation || "shopStock"}. Purchase Price: ৳${purItem.purchasePrice}, Base Price: ৳${purItem.basePrice}, Discount Price: ৳${purItem.discountPrice}.`,
      metadata: {
        purchaseId: purItem.purchaseId,
        productName: product.name,
        addedQuantity: purItem.quantity,
        targetLocation: purItem.targetLocation || "shopStock",
        purchasePrice: purItem.purchasePrice,
        basePrice: purItem.basePrice,
        discountPrice: purItem.discountPrice,
        batchId: purItem.batchId,
      },
    });
  }

  res.status(200).json({
    success: true,
    message: `Purchase batch approved! ${itemsToApprove.length} item(s) updated with +${totalAddedUnits} units in stock.`,
    data: purchase,
  });
});

// @desc    Reject stock purchase request (Admin Only)
// @route   PUT /api/purchase/:id/reject
// @access  Private (Admin Only)
const rejectPurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);

  if (!purchase) {
    return res.status(404).json({
      success: false,
      message: "Stock purchase record not found",
    });
  }

  let itemsToReject = [];
  if (purchase.batchId) {
    itemsToReject = await Purchase.find({
      batchId: purchase.batchId,
      status: "pending",
    });
  }

  if (itemsToReject.length === 0 && purchase.status === "pending") {
    itemsToReject = [purchase];
  }

  if (itemsToReject.length === 0) {
    return res.status(400).json({
      success: false,
      message: `Purchase request is already in '${purchase.status}' status and cannot be modified.`,
    });
  }

  const rejectionReason = (req.body.rejectionReason || req.body.notes || req.body.reason || "").trim();

  for (const purItem of itemsToReject) {
    purItem.status = "rejected";
    if (rejectionReason) {
      purItem.rejectionReason = rejectionReason;
    }
    purItem.approvedBy = req.user.id || req.user._id;
    purItem.approvedByName = req.user.name || "Admin";
    purItem.approvedAt = new Date();
    await purItem.save();

    logActivity({
      req,
      action: "REJECT_PURCHASE",
      entityType: "Purchase",
      entityId: purItem._id,
      description: `Rejected stock purchase "${purItem.purchaseId}" for "${purItem.productName}". Reason: ${rejectionReason || "None specified"}. Stock remains unchanged.`,
      metadata: {
        purchaseId: purItem.purchaseId,
        productName: purItem.productName,
        batchId: purItem.batchId,
        rejectionReason,
      },
    });
  }

  res.status(200).json({
    success: true,
    message: `Stock purchase request(s) rejected (${itemsToReject.length} item(s)).`,
    data: purchase,
  });
});

// @desc    Delete purchase record (Admin Only)
// @route   DELETE /api/purchase/:id
// @access  Private (Admin Only)
const deletePurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);

  if (!purchase) {
    return res.status(404).json({
      success: false,
      message: "Stock purchase record not found",
    });
  }

  if (purchase.status === "approved") {
    return res.status(400).json({
      success: false,
      message: "Cannot delete an approved stock purchase record. (Stock was already added to product).",
    });
  }

  if (purchase.batchId) {
    await Purchase.deleteMany({ batchId: purchase.batchId, status: { $ne: "approved" } });
  } else {
    await purchase.deleteOne();
  }

  logActivity({
    req,
    action: "DELETE_PURCHASE",
    entityType: "Purchase",
    entityId: req.params.id,
    description: `Deleted purchase record "${purchase.purchaseId || req.params.id}"`,
    metadata: { purchaseId: purchase.purchaseId },
  });

  res.status(200).json({
    success: true,
    message: "Stock purchase record deleted successfully",
  });
});

// @desc    Get logged in user's stock purchase requests
// @route   GET /api/purchase/my-requests
// @access  Private (Manager, Employee, Admin)
const getMyPurchases = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    vendor,
    startDate,
    endDate,
    specificDate,
    period,
  } = req.query;

  const query = { createdBy: req.user.id || req.user._id };

  // Status Filter
  if (status && ["pending", "approved", "rejected"].includes(status.toLowerCase())) {
    query.status = status.toLowerCase();
  }

  // Vendor Filter
  if (vendor) {
    query.vendor = vendor;
  }

  // Date Filtering (checks purchaseDate, updatedAt, or createdAt)
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    query.$and = (query.$and || []).concat([
      {
        $or: [
          { purchaseDate: dateFilterCond },
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
          { purchaseDate: dateRangeCond },
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
            { purchaseDate: { $gte: periodStartDate } },
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } }
          ]
        }
      ]);
    }
  }

  // Text Search
  if (search && search.trim()) {
    const searchTrimmed = search.trim();
    const regex = new RegExp(searchTrimmed, "i");

    // Find matching products by name or productId/customId
    const matchingProducts = await Product.find({
      $or: [
        { name: regex },
        { productId: regex },
        { customId: regex },
      ],
    })
      .select("_id")
      .lean();

    const matchingProductIds = matchingProducts.map((p) => p._id);

    const searchCond = [
      { purchaseId: regex },
      { productName: regex },
      { productIdCode: regex },
      { batchId: regex },
      { vendorName: regex },
      { createdByName: regex },
      { invoiceNo: regex },
      { notes: regex },
      { productSize: regex },
      { productColor: regex },
      ...(matchingProductIds.length > 0
        ? [{ product: { $in: matchingProductIds } }]
        : []),
    ];
    query.$and = (query.$and || []).concat([{ $or: searchCond }]);
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const [purchases, totalCount, statusCounts, totalCostAgg] = await Promise.all([
    Purchase.find(query)
      .populate({
        path: "product",
        select: "name productId bannerImage images variation vendor sku barcode price",
        populate: { path: "vendor", select: "name phone" },
      })
      .populate("vendor", "name phone")
      .populate("createdBy", "name email role")
      .populate("approvedBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Purchase.countDocuments(query),
    Purchase.aggregate([
      { $match: { createdBy: req.user.id || req.user._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Purchase.aggregate([
      { $match: { createdBy: req.user.id || req.user._id } },
      { $group: { _id: null, grandTotalCost: { $sum: "$totalCost" }, totalPurchases: { $sum: 1 } } },
    ]),
  ]);

  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  statusCounts.forEach((s) => {
    if (s._id === "pending") pendingCount = s.count;
    else if (s._id === "approved") approvedCount = s.count;
    else if (s._id === "rejected") rejectedCount = s.count;
  });

  const stats = {
    totalPurchases: totalCostAgg[0]?.totalPurchases || 0,
    pendingCount,
    approvedCount,
    rejectedCount,
    grandTotalCost: totalCostAgg[0]?.grandTotalCost || 0,
  };

  const groupedPurchases = [];
  const batchMap = new Map();

  for (const item of purchases) {
    const itemObj = item.toObject ? item.toObject() : item;
    let groupKey = itemObj.batchId;
    if (!groupKey) {
      const creatorId = itemObj.createdBy?._id || itemObj.createdBy || "unknown";
      const timeBucket = Math.floor(new Date(itemObj.createdAt || itemObj.purchaseDate).getTime() / 5000);
      groupKey = `batch_${creatorId}_${timeBucket}`;
    }

    if (!batchMap.has(groupKey)) {
      const batchEntry = {
        ...itemObj,
        batchId: itemObj.batchId || groupKey,
        itemCount: 1,
        totalQuantity: Number(itemObj.quantity) || 0,
        totalBatchCost: Number(itemObj.totalCost) || 0,
        batchItems: [itemObj],
      };
      batchMap.set(groupKey, batchEntry);
      groupedPurchases.push(batchEntry);
    } else {
      const existing = batchMap.get(groupKey);
      existing.itemCount += 1;
      existing.totalQuantity += Number(itemObj.quantity) || 0;
      existing.totalBatchCost += Number(itemObj.totalCost) || 0;
      existing.batchItems.push(itemObj);
    }
  }

  res.status(200).json({
    success: true,
    data: groupedPurchases,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems: groupedPurchases.length,
      totalPages: Math.ceil(groupedPurchases.length / limitNum) || 1,
    },
    stats,
  });
});

module.exports = {
  createPurchase,
  getPurchases,
  getMyPurchases,
  getPurchaseById,
  approvePurchase,
  rejectPurchase,
  deletePurchase,
};
