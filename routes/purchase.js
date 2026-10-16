/**
 * ============================================================
 * routes/purchase.js — Stock Purchase Routes
 * ============================================================
 * /api/purchase এন্ডপয়েন্টসমূহের রাউটিং রেজিস্ট্রি।
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  createPurchase,
  getPurchases,
  getMyPurchases,
  getPurchaseById,
  approvePurchase,
  rejectPurchase,
  deletePurchase,
} = require("../controllers/purchaseController");

// All purchase routes require authentication
router.use(authenticate);

router.get("/my-requests", authorize("admin", "manager", "employee", "my_purchases.view", "purchases.view"), getMyPurchases);

router.route("/")
  .post(authorize("admin", "manager", "purchases.create"), createPurchase)
  .get(authorize("admin", "manager", "purchases.view"), getPurchases);

router.route("/:id")
  .get(authorize("admin", "manager", "purchases.view"), getPurchaseById)
  .delete(authorize("admin", "purchases.delete"), deletePurchase);

router.put("/:id/approve", authorize("admin", "purchases.edit", "purchases.create"), approvePurchase);
router.put("/:id/reject", authorize("admin", "purchases.edit", "purchases.create"), rejectPurchase);

module.exports = router;
