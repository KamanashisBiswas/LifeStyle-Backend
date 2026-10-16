const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticate, authorize, optionalAuth } = require("../middleware/auth");
const {
  getNewArrivalProducts,
  getNewArrivalConfigAdmin,
  updateNewArrivalConfigAdmin,
} = require("../controllers/newArrivalController");

// Multer in-memory storage configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Public Endpoint
router.get("/", optionalAuth, getNewArrivalProducts);

// Admin Endpoints
router.get("/admin", authenticate, authorize("admin", "manager", "employee"), getNewArrivalConfigAdmin);
router.put("/admin", authenticate, authorize("admin"), upload.single("bannerImage"), updateNewArrivalConfigAdmin);

module.exports = router;
