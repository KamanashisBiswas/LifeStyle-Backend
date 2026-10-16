/**
 * ============================================================
 * routes/ownerPayout.js — Shop Owner Payout Routes
 * ============================================================
 * /api/owner-payout এন্ডপয়েন্টসমূহের রাউটিং রেজিস্ট্রি।
 *
 * Rules:
 *  - Manager, Employee, Admin → Create & View Payouts
 *  - Admin Only → Edit (PUT) & Delete (DELETE)
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  createPayout,
  getAllPayouts,
  getPayoutById,
  updatePayout,
  deletePayout,
  getPayoutSummary,
  replyPayoutFeedback,
  approvePayout,
} = require("../controllers/ownerPayoutController");

// All routes require authentication
router.use(authenticate);

// Quick summary of profits & payouts
router.get("/summary", authorize("admin", "owner_payouts.view"), getPayoutSummary);

// Reply to manager's feedback on a payout
router.post("/:id/reply", authorize("admin", "owner_payouts.view"), replyPayoutFeedback);

// Approve payout (Admin or owner_payouts.approve)
router.put("/:id/approve", authorize("admin", "owner_payouts.approve"), approvePayout);

router
  .route("/")
  .post(authorize("admin", "owner_payouts.create"), createPayout)
  .get(authorize("admin", "owner_payouts.view"), getAllPayouts);

router
  .route("/:id")
  .get(authorize("admin", "owner_payouts.view"), getPayoutById)
  .put(authorize("admin", "owner_payouts.edit"), updatePayout)
  .delete(authorize("admin", "owner_payouts.delete"), deletePayout);

module.exports = router;
