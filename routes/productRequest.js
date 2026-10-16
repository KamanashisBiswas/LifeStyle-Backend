/**
 * ============================================================
 * routes/productRequest.js — Product Requests Routes
 * ============================================================
 * Endpoints for managing New & Existing Product Requests:
 *  - GET    /api/admin/product-requests            -> List requests (Admin, Employee, Manager)
 *  - POST   /api/admin/product-requests            -> Create request (Manager, Employee, Admin)
 *  - GET    /api/admin/product-requests/:id        -> Single request details (Admin, Employee, Manager)
 *  - POST   /api/admin/product-requests/:id/seen   -> Mark request as seen (Admin, Employee, Manager)
 *  - POST   /api/admin/product-requests/:id/feedback -> Add comment/feedback (Admin, Employee, Manager)
 *  - POST   /api/admin/product-requests/:id/end    -> End/Close request to History (Admin only)
 *  - DELETE /api/admin/product-requests/:id        -> Delete request (Admin only)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  getProductRequests,
  createProductRequest,
  getProductRequestById,
  markRequestAsSeen,
  addFeedback,
  endProductRequest,
  deleteProductRequest,
} = require("../controllers/productRequestController");

// All routes require authentication
router.use(authenticate);

router
  .route("/")
  .get(authorize("admin", "manager", "product_requests.view", "product_requests.manage"), getProductRequests)
  .post(authorize("admin", "manager", "product_requests.create", "product_requests.manage"), createProductRequest);

router
  .route("/:id")
  .get(authorize("admin", "manager", "product_requests.view", "product_requests.manage"), getProductRequestById)
  .delete(authorize("admin", "product_requests.manage"), deleteProductRequest);

router
  .route("/:id/seen")
  .post(authorize("admin", "manager", "product_requests.view", "product_requests.manage"), markRequestAsSeen);

router
  .route("/:id/feedback")
  .post(authorize("admin", "manager", "product_requests.create", "product_requests.manage"), addFeedback);

router
  .route("/:id/end")
  .post(authorize("admin", "product_requests.manage"), endProductRequest);

module.exports = router;
