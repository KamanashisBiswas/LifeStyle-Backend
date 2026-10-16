/**
 * ============================================================
 * controllers/productRequestController.js — Product Requests Controller
 * ============================================================
 */

const ProductRequest = require("../models/ProductRequest");
const Product = require("../models/Product");
const Category = require("../models/Category");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Helper to deduplicate seenBy entries by user ID or userName (keeping latest timestamp)
 */
const deduplicateSeenBy = (list) => {
  const map = new Map();
  (list || []).forEach((s) => {
    const key = s.user?._id
      ? s.user._id.toString()
      : s.user
      ? s.user.toString()
      : (s.userName || "unknown").toLowerCase();
    if (!map.has(key) || new Date(s.seenAt) > new Date(map.get(key).seenAt)) {
      map.set(key, s);
    }
  });
  return Array.from(map.values());
};

/**
 * @desc    Get paginated product requests (Active or History)
 * @route   GET /api/admin/product-requests
 * @access  Private (Admin, Employee, Manager)
 */
const getProductRequests = asyncHandler(async (req, res) => {
  const {
    tab = "active", // "active" | "history" | "all"
    requestType, // "new_product" | "existing_product" | "all"
    status,
    search,
    period,
    specificDate,
    startDate,
    endDate,
    page = 1,
    limit = 20,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 20);
  const skip = (pageNum - 1) * limitNum;

  // Build filter
  const filter = {};

  if (tab === "active") {
    filter.status = { $in: ["pending", "in_progress"] };
  } else if (tab === "history") {
    filter.status = { $in: ["completed", "rejected"] };
  } else if (status && status !== "all") {
    filter.status = status;
  }

  if (requestType && requestType !== "all") {
    filter.requestType = requestType;
  }

  if (search && search.trim() !== "") {
    const s = search.trim();
    filter.$or = [
      { productName: { $regex: s, $options: "i" } },
      { requestCode: { $regex: s, $options: "i" } },
      { productIdCode: { $regex: s, $options: "i" } },
      { categoryName: { $regex: s, $options: "i" } },
      { "requestedBy.name": { $regex: s, $options: "i" } },
      { description: { $regex: s, $options: "i" } },
    ];
  }

  // Date Filtering: specificDate, date range, or quick period
  if (specificDate) {
    const start = new Date(specificDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(specificDate);
    end.setHours(23, 59, 59, 999);
    filter.createdAt = { $gte: start, $lte: end };
  } else if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filter.createdAt.$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  } else if (period && period !== "all") {
    const now = new Date();
    let periodStartDate = null;
    switch (period) {
      case "daily":
      case "today":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "weekly":
      case "week":
        periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
      case "month":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
      case "year":
        periodStartDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        periodStartDate = null;
    }
    if (periodStartDate) {
      filter.createdAt = { $gte: periodStartDate };
    }
  }

  // Count metrics for summary tabs
  const [activeCount, historyCount, totalCount, rawRequests, count] = await Promise.all([
    ProductRequest.countDocuments({ status: { $in: ["pending", "in_progress"] } }),
    ProductRequest.countDocuments({ status: { $in: ["completed", "rejected"] } }),
    ProductRequest.countDocuments(),
    ProductRequest.find(filter)
      .populate("category", "name")
      .populate("existingProduct", "name productId images variation")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ProductRequest.countDocuments(filter),
  ]);

  const requests = rawRequests.map((r) => ({
    ...r,
    seenBy: deduplicateSeenBy(r.seenBy),
  }));

  const stats = {
    totalRequests: totalCount,
    totalCount,
    activeCount,
    historyCount,
  };

  res.status(200).json({
    success: true,
    data: requests,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum) || 1,
      totalItems: count,
      limit: limitNum,
    },
    stats,
  });
});

/**
 * @desc    Create a new product request (New or Existing)
 * @route   POST /api/admin/product-requests
 * @access  Private (Manager, Employee, Admin)
 */
const createProductRequest = asyncHandler(async (req, res) => {
  const {
    requestType = "new_product",
    productName,
    category,
    categoryName,
    targetPrice,
    estimatedQuantity,
    description,
    images,
    existingProduct,
    productIdCode,
    productThumbnail,
    requestReason,
    requestedQuantity,
    priority = "medium",
    initialFeedback,
  } = req.body;

  let finalProductName = productName;
  let finalCategoryName = categoryName;
  let finalThumbnail = productThumbnail;
  let finalProductIdCode = productIdCode;

  // Validate existing product if requestType is existing_product
  if (requestType === "existing_product") {
    if (!existingProduct) {
      return res.status(400).json({
        success: false,
        message: "Existing product selection is required",
      });
    }

    const prod = await Product.findById(existingProduct).populate("category", "name");
    if (!prod) {
      return res.status(404).json({
        success: false,
        message: "Selected existing product not found",
      });
    }

    finalProductName = prod.name;
    finalCategoryName = prod.category?.name || "";
    finalProductIdCode = prod.productId || "";
    finalThumbnail =
      (prod.images && prod.images.length > 0 ? prod.images[0] : prod.bannerImage) || "";
  } else {
    // New product validation
    if (!finalProductName || finalProductName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Product name is required for new product request",
      });
    }

    if (category) {
      const cat = await Category.findById(category);
      if (cat) finalCategoryName = cat.name;
    }
  }

  const requestedBy = {
    user: req.user._id,
    name: req.user.name || "User",
    role: req.user.role || "manager",
    email: req.user.email || "",
    avatar: req.user.avatar || null,
  };

  // Build feedback list if initial note/feedback is provided
  const feedbacks = [];
  if (initialFeedback && initialFeedback.trim() !== "") {
    feedbacks.push({
      user: req.user._id,
      userName: req.user.name || "Requester",
      userRole: req.user.role || "manager",
      userAvatar: req.user.avatar || null,
      message: initialFeedback.trim(),
      createdAt: new Date(),
    });
  }

  // Creator has seen their own request
  const seenBy = [
    {
      user: req.user._id,
      userName: req.user.name || "Requester",
      userRole: req.user.role || "manager",
      userAvatar: req.user.avatar || null,
      seenAt: new Date(),
    },
  ];

  const newRequest = await ProductRequest.create({
    requestType,
    productName: finalProductName,
    category: category || null,
    categoryName: finalCategoryName,
    targetPrice: Number(targetPrice) || 0,
    estimatedQuantity: Number(estimatedQuantity) || 0,
    description: description || "",
    images: Array.isArray(images) ? images : [],
    existingProduct: existingProduct || null,
    productIdCode: finalProductIdCode,
    productThumbnail: finalThumbnail,
    requestReason: requestReason || "reorder",
    requestedQuantity: Number(requestedQuantity) || 0,
    requestedBy,
    status: "pending",
    priority,
    seenBy,
    feedbacks,
  });

  res.status(201).json({
    success: true,
    message: "Product request submitted successfully",
    data: newRequest,
  });
});

/**
 * @desc    Get single product request details
 * @route   GET /api/admin/product-requests/:id
 * @access  Private (Admin, Employee, Manager)
 */
const getProductRequestById = asyncHandler(async (req, res) => {
  const request = await ProductRequest.findById(req.params.id)
    .populate("category", "name")
    .populate("existingProduct", "name productId images variation")
    .populate("feedbacks.user", "name role avatar")
    .populate("seenBy.user", "name role avatar");

  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Product request not found",
    });
  }

  const data = request.toObject();
  data.seenBy = deduplicateSeenBy(data.seenBy);

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * @desc    Mark request as seen by the current logged-in user (Admin / Employee)
 * @route   POST /api/admin/product-requests/:id/seen
 * @access  Private (Admin, Employee, Manager)
 */
const markRequestAsSeen = asyncHandler(async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Product request not found",
    });
  }

  const userIdStr = (req.user._id || req.user.id || "").toString();
  const userName = req.user.name || "User";
  const userRole = (req.user.role || "user").toLowerCase();
  const userAvatar = req.user.avatar || null;

  // Filter out any previous seen entry for this user
  const currentSeenList = (request.seenBy || []).filter((s) => {
    const sUserId = s.user?._id
      ? s.user._id.toString()
      : s.user
      ? s.user.toString()
      : "";
    if (sUserId && userIdStr && sUserId === userIdStr) return false;
    if (s.userName && s.userName.toLowerCase() === userName.toLowerCase() && s.userRole === userRole) return false;
    return true;
  });

  currentSeenList.push({
    user: req.user._id,
    userName,
    userRole,
    userAvatar,
    seenAt: new Date(),
  });

  request.seenBy = deduplicateSeenBy(currentSeenList);
  await request.save();

  res.status(200).json({
    success: true,
    message: "Request marked as seen",
    data: request.seenBy,
  });
});

/**
 * @desc    Add feedback comment to the request thread
 * @route   POST /api/admin/product-requests/:id/feedback
 * @access  Private (Admin, Employee, Manager)
 */
const addFeedback = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Feedback message cannot be empty",
    });
  }

  const request = await ProductRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Product request not found",
    });
  }

  const newFeedback = {
    user: req.user._id,
    userName: req.user.name || "User",
    userRole: req.user.role || "user",
    userAvatar: req.user.avatar || null,
    message: message.trim(),
    createdAt: new Date(),
  };

  request.feedbacks.push(newFeedback);

  // If status was pending and feedback is posted by Admin/Employee, we can mark as in_progress
  if (request.status === "pending" && ["admin", "employee"].includes(req.user.role)) {
    request.status = "in_progress";
  }

  // Also ensure commenter is recorded in seenBy
  const userId = req.user._id.toString();
  const existingSeenIndex = request.seenBy.findIndex(
    (s) => s.user && s.user.toString() === userId
  );
  if (existingSeenIndex >= 0) {
    request.seenBy[existingSeenIndex].seenAt = new Date();
  } else {
    request.seenBy.push({
      user: req.user._id,
      userName: req.user.name || "User",
      userRole: req.user.role || "user",
      userAvatar: req.user.avatar || null,
      seenAt: new Date(),
    });
  }

  await request.save();

  res.status(201).json({
    success: true,
    message: "Feedback added successfully",
    data: request.feedbacks,
    status: request.status,
  });
});

/**
 * @desc    End / Close / Complete a product request (Admin Only) -> Moves to History tab
 * @route   POST /api/admin/product-requests/:id/end
 * @access  Private (Admin Only)
 */
const endProductRequest = asyncHandler(async (req, res) => {
  const { closingNote, status = "completed" } = req.body;

  const request = await ProductRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Product request not found",
    });
  }

  request.status = status === "rejected" ? "rejected" : "completed";
  request.endedBy = {
    user: req.user._id,
    name: req.user.name || "Admin",
    role: req.user.role || "admin",
    endedAt: new Date(),
    closingNote: closingNote || "",
  };

  await request.save();

  res.status(200).json({
    success: true,
    message: `Product request ended and moved to History (${request.status})`,
    data: request,
  });
});

/**
 * @desc    Delete a product request (Admin Only)
 * @route   DELETE /api/admin/product-requests/:id
 * @access  Private (Admin Only)
 */
const deleteProductRequest = asyncHandler(async (req, res) => {
  const request = await ProductRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Product request not found",
    });
  }

  await ProductRequest.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: "Product request deleted successfully",
  });
});

module.exports = {
  getProductRequests,
  createProductRequest,
  getProductRequestById,
  markRequestAsSeen,
  addFeedback,
  endProductRequest,
  deleteProductRequest,
};
