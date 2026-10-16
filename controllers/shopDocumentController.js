/**
 * ============================================================
 * controllers/shopDocumentController.js — Shop Documents Controller
 * ============================================================
 * দোকানের আইনি ও অফিশিয়াল ডকুমেন্টস (ট্রেড লাইসেন্স, টিন, ভ্যাট/বিন,
 * ভাড়ার চুক্তিপত্র, ব্যাংক ডকুমেন্ট ইত্যাদি) আপলোড, আপডেট, ভিউ ও ডিলিট।
 *
 * Rules:
 *  - Admin Only: Create, Update, Delete
 *  - All Authenticated Roles (Admin, Employee, Manager, Salesman): Get & View
 * ============================================================
 */

const ShopDocument = require("../models/ShopDocument");
const ActivityLog = require("../models/ActivityLog");
const asyncHandler = require("../utils/asyncHandler");
const cloudinary = require("../config/cloudinary").cloudinary;

// Helper: Upload file buffer to Cloudinary with auto resource type (for Images & PDF)
const uploadBufferToCloudinary = (buffer, folder, public_id) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder || "lifestyle/shop-documents",
        public_id: public_id,
        resource_type: "auto", // Handles JPG, PNG, WEBP, PDF
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

// Helper: Delete file from Cloudinary
const deleteFileFromCloudinary = async (publicId, resourceType = "image") => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.warn("Cloudinary delete error:", error.message);
  }
};

// Helper: Record activity log
const logActivity = async (req, action, doc) => {
  try {
    if (!req.user) return;
    await ActivityLog.create({
      user: req.user._id || req.user.id,
      userName: req.user.name || "Admin",
      userEmail: req.user.email || "",
      userRole: req.user.role || "admin",
      action,
      entityType: "ShopDocument",
      entityId: doc._id?.toString() || "",
      metadata: {
        documentTitle: doc.title,
        documentType: doc.documentType,
        documentNumber: doc.documentNumber,
      },
    });
  } catch (err) {
    console.warn("Failed to record activity log for ShopDocument:", err.message);
  }
};

// ─── 1. Get All Shop Documents (With Search & Filter) ────────
// GET /api/shop-documents
exports.getAllDocuments = asyncHandler(async (req, res) => {
  const {
    search,
    documentType,
    status,
    sortBy = "createdAt",
    order = "desc",
    page = 1,
    limit = 10,
  } = req.query;

  const query = {};

  if (documentType && documentType !== "All" && documentType !== "all") {
    query.documentType = documentType;
  }

  if (status && status !== "All" && status !== "all") {
    query.status = status;
  }

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    query.$or = [
      { title: regex },
      { documentNumber: regex },
      { documentType: regex },
      { notes: regex },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const skip = (pageNum - 1) * limitNum;

  const sortOptions = {};
  sortOptions[sortBy] = order === "asc" ? 1 : -1;

  const [documents, total] = await Promise.all([
    ShopDocument.find(query)
      .populate("uploadedBy", "name email role")
      .populate("updatedBy", "name email role")
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ShopDocument.countDocuments(query),
  ]);

  // Document Summary Statistics
  const [totalCount, activeCount, expiringSoonCount, typeStats] = await Promise.all([
    ShopDocument.countDocuments(),
    ShopDocument.countDocuments({ status: "active" }),
    ShopDocument.countDocuments({
      expiryDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Next 30 days
      },
    }),
    ShopDocument.aggregate([
      { $group: { _id: "$documentType", count: { $sum: 1 } } },
    ]),
  ]);

    const docSummary = {
      totalDocuments: totalCount,
      activeDocuments: activeCount,
      expiringSoon: expiringSoonCount,
      typeBreakdown: typeStats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
    };

    res.status(200).json({
      success: true,
      data: documents,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      stats: docSummary,
    });
});

// ─── 2. Get Single Shop Document By ID ──────────────────────
// GET /api/shop-documents/:id
exports.getDocumentById = asyncHandler(async (req, res) => {
  const document = await ShopDocument.findById(req.params.id)
    .populate("uploadedBy", "name email role")
    .populate("updatedBy", "name email role");

  if (!document) {
    return res.status(404).json({
      success: false,
      message: "Shop document not found",
    });
  }

  res.status(200).json({
    success: true,
    data: document,
  });
});

// ─── 3. Create Shop Document (Admin Only) ───────────────────
// POST /api/shop-documents
exports.createDocument = asyncHandler(async (req, res) => {
  const {
    title,
    documentType,
    documentNumber,
    issueDate,
    expiryDate,
    notes,
    status = "active",
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      message: "Document title is required",
    });
  }

  if (!req.file && !req.body.fileUrl) {
    return res.status(400).json({
      success: false,
      message: "Document file (PDF or Image) is required",
    });
  }

  let fileUrl = req.body.fileUrl || "";
  let publicId = "";
  let fileType = "image";
  let fileName = req.file?.originalname || "Document";
  let fileSize = req.file?.size || 0;

  if (req.file) {
    const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname?.toLowerCase().endsWith(".pdf");
    fileType = isPdf ? "pdf" : "image";

    const customPublicId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const uploadResult = await uploadBufferToCloudinary(
      req.file.buffer,
      "lifestyle/shop-documents",
      customPublicId
    );

    fileUrl = uploadResult.secure_url || uploadResult.url;
    publicId = uploadResult.public_id;
  }

  const document = await ShopDocument.create({
    title: title.trim(),
    documentType: documentType || "Other",
    documentNumber: documentNumber ? documentNumber.trim() : "",
    issueDate: issueDate ? new Date(issueDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    fileUrl,
    publicId,
    fileType,
    fileName,
    fileSize,
    notes: notes ? notes.trim() : "",
    status,
    uploadedBy: req.user._id || req.user.id,
  });

  const populatedDoc = await ShopDocument.findById(document._id).populate(
    "uploadedBy",
    "name email role"
  );

  await logActivity(req, `Uploaded Shop Document: "${document.title}"`, document);

  res.status(201).json({
    success: true,
    message: "Shop document uploaded successfully",
    data: populatedDoc,
  });
});

// ─── 4. Update Shop Document (Admin Only) ───────────────────
// PUT /api/shop-documents/:id
exports.updateDocument = asyncHandler(async (req, res) => {
  const document = await ShopDocument.findById(req.params.id);

  if (!document) {
    return res.status(404).json({
      success: false,
      message: "Shop document not found",
    });
  }

  const {
    title,
    documentType,
    documentNumber,
    issueDate,
    expiryDate,
    notes,
    status,
  } = req.body;

  if (title !== undefined) document.title = title.trim();
  if (documentType !== undefined) document.documentType = documentType;
  if (documentNumber !== undefined) document.documentNumber = documentNumber.trim();
  if (issueDate !== undefined) document.issueDate = issueDate ? new Date(issueDate) : null;
  if (expiryDate !== undefined) document.expiryDate = expiryDate ? new Date(expiryDate) : null;
  if (notes !== undefined) document.notes = notes.trim();
  if (status !== undefined) document.status = status;
  document.updatedBy = req.user._id || req.user.id;

  // Handle new file replacement if provided
  if (req.file) {
    // Delete old file from Cloudinary if exists
    if (document.publicId) {
      const oldResourceType = document.fileType === "pdf" ? "raw" : "image";
      await deleteFileFromCloudinary(document.publicId, oldResourceType);
    }

    const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname?.toLowerCase().endsWith(".pdf");
    document.fileType = isPdf ? "pdf" : "image";
    document.fileName = req.file.originalname;
    document.fileSize = req.file.size;

    const customPublicId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const uploadResult = await uploadBufferToCloudinary(
      req.file.buffer,
      "lifestyle/shop-documents",
      customPublicId
    );

    document.fileUrl = uploadResult.secure_url || uploadResult.url;
    document.publicId = uploadResult.public_id;
  }

  await document.save();

  const updatedDoc = await ShopDocument.findById(document._id)
    .populate("uploadedBy", "name email role")
    .populate("updatedBy", "name email role");

  await logActivity(req, `Updated Shop Document: "${document.title}"`, document);

  res.status(200).json({
    success: true,
    message: "Shop document updated successfully",
    data: updatedDoc,
  });
});

// ─── 5. Delete Shop Document (Admin Only) ───────────────────
// DELETE /api/shop-documents/:id
exports.deleteDocument = asyncHandler(async (req, res) => {
  const document = await ShopDocument.findById(req.params.id);

  if (!document) {
    return res.status(404).json({
      success: false,
      message: "Shop document not found",
    });
  }

  // Delete from Cloudinary
  if (document.publicId) {
    const resourceType = document.fileType === "pdf" ? "raw" : "image";
    await deleteFileFromCloudinary(document.publicId, resourceType);
  }

  const docTitle = document.title;
  await document.deleteOne();

  await logActivity(req, `Deleted Shop Document: "${docTitle}"`, {
    _id: req.params.id,
    title: docTitle,
    documentType: document.documentType,
    documentNumber: document.documentNumber,
  });

  res.status(200).json({
    success: true,
    message: "Shop document deleted successfully",
  });
});
