/**
 * ============================================================
 * routes/pathao.js — Pathao Courier Integration Routes
 * ============================================================
 * Base path: /api/admin/pathao
 * ============================================================
 */
const express = require("express");
const router = express.Router();
const {
  getStores,
  createStore,
  getCities,
  getZones,
  getAreas,
  calculatePrice,
  sendOrderToPathao,
  trackPathaoOrder,
} = require("../controllers/pathaoController");
const { authenticate, authorize } = require("../middleware/auth");

// All Pathao admin routes require authentication & role authorization
router.use(authenticate);
router.use(authorize("admin", "employee", "manager"));

router.route("/stores").get(getStores).post(createStore);
router.route("/cities").get(getCities);
router.route("/cities/:cityId/zones").get(getZones);
router.route("/zones/:zoneId/areas").get(getAreas);
router.route("/calculate-price").post(calculatePrice);
router.route("/create-order").post(sendOrderToPathao);
router.route("/track/:consignmentId").get(trackPathaoOrder);

module.exports = router;
