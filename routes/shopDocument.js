/**
 * ============================================================
 * routes/shopDocument.js — Shop Documents Routes
 * ============================================================
 * Endpoints for managing shop business & legal documents.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticate, authorize } = require("../middleware/auth");
const {
  getAllDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
} = require("../controllers/shopDocumentController");

// Multer setup for memory storage (15MB max file size, image/pdf support)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "application/pdf",
    ];
    if (
      allowedMimeTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(jpg|jpeg|png|webp|pdf)$/i)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JPG, PNG, WEBP images and PDF files are allowed."
        ),
        false
      );
    }
  },
});

// ─── Document Routes ──────────────────────────────────────────

// Read routes: Admin or shop_documents.view or shop_documents.manage
router.get("/", authenticate, authorize("admin", "shop_documents.view", "shop_documents.manage"), getAllDocuments);
router.get("/:id", authenticate, authorize("admin", "shop_documents.view", "shop_documents.manage"), getDocumentById);

// Write routes: Admin or shop_documents.*
router.post(
  "/",
  authenticate,
  authorize("admin", "shop_documents.create", "shop_documents.manage"),
  upload.single("file"),
  createDocument
);

router.put(
  "/:id",
  authenticate,
  authorize("admin", "shop_documents.create", "shop_documents.manage"),
  upload.single("file"),
  updateDocument
);

router.delete(
  "/:id",
  authenticate,
  authorize("admin", "shop_documents.delete", "shop_documents.manage"),
  deleteDocument
);

module.exports = router;
