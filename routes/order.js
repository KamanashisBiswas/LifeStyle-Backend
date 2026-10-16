/**
 * ============================================================
 * routes/order.js — Order Routes
 * ============================================================
 * Base path: /api/order
 *
 * Route সমূহ:
 *  POST /api/order/return                → authenticate + authorize(salesman), returnOrder
 *  POST /api/order/admin-create          → authenticate + authorize(admin/employee), createOrderByAdmin
 *  POST /api/order                       → authenticateCustomer, createOrder (Customer online order)
 *  GET  /api/order/all                   → authenticate + authorize, getAllOrders
 *  GET  /api/order/my-orders             → authenticateCustomer, getMyOrders (Customer ঊর orders)
 *  GET  /api/order/my-sells              → authenticate + authorize(salesman), getMySells
 *  GET  /api/order/customer/:customerId  → authenticate + authorize, getOrdersByCustomerId
 *  GET  /api/order/:id                   → authenticate, getOrderById
 *  PUT  /api/order/:id/status            → authenticate + authorize, updateOrderStatus
 *  DELETE /api/order/:id                 → authenticate + authorize(admin), deleteOrder
 * ============================================================
 */

const express = require("express");
const {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
  getMyOrders,
  createOrderByAdmin, // Import the new controller
  getOrdersByCustomerId, // Import the new controller
  getMySells, // Import the salesman sells controller
  returnOrder, // Import the return order controller
  getMyOrdersForReturn, // Import the new controller for return search
  checkOrderType, // Import the order type checker
  checkCourierFraud, // Import courier check controller
} = require("../controllers/orderController");
const {
  authenticate,
  authorize,
  authenticateCustomer,
} = require("../middleware/auth"); // Import authenticateCustomer
const {
  validateCreateOrder,
  validateOrderId,
  validateUpdateOrderStatus,
} = require("../validations/orderValidation");

const publicRouter = express.Router();
const adminRouter = express.Router();

// Route to check courier parcel history & fraud report via BDCourier
adminRouter
  .route("/courier-check")
  .post(authenticate, authorize("admin", "employee", "manager", "orders.all_view"), checkCourierFraud);

// Route for returning an order (restores stock and deletes order)
// Only Manager/Admin can return shop orders
adminRouter.route("/return").post(authenticate, authorize("admin", "manager", "shop_returns.create", "shop_returns.view"), returnOrder);

// Route for manager to get shop orders for return
adminRouter
  .route("/my-orders-for-return")
  .get(authenticate, authorize("admin", "manager", "shop_returns.create", "shop_returns.view"), getMyOrdersForReturn);

// Route to check order type by orderId (for return validation)
adminRouter
  .route("/check-type/:orderId")
  .get(authenticate, authorize("admin", "manager", "shop_returns.create", "shop_returns.view"), checkOrderType);

// Route for Admin/Employee/Manager to create an order
adminRouter
  .route("/admin-create")
  .post(
    authenticate,
    authorize("admin", "employee", "manager", "orders.create"),
    validateCreateOrder,
    createOrderByAdmin,
  );


// Route for a logged-in customer to get their own orders
publicRouter.route("/my-orders").get(authenticateCustomer, getMyOrders);

// Route for a logged-in manager/salesman to get sell history
adminRouter.route("/my-sells").get(authenticate, authorize("admin", "manager", "salesman", "pos.my_sell"), getMySells);

// Admin route to get orders for a specific customer
adminRouter
  .route("/by-customer/:customerId")
  .get(authenticate, authorize("admin", "employee", "manager", "orders.all_view", "customers.view"), getOrdersByCustomerId);

// Admin route to get all orders
adminRouter
  .route("/")
  .get(authenticate, authorize("admin", "employee", "manager", "orders.all_view"), getAllOrders); // GET /api/admin/order

// Customer route to create an order
publicRouter
  .route("/")
  .post(authenticateCustomer, validateCreateOrder, createOrder); // POST /api/order

adminRouter
  .route("/:id")
  .get(
    authenticate,
    authorize("admin", "employee", "manager", "orders.all_view", "orders.shop_view"),
    validateOrderId,
    getOrderById,
  );

// New route specifically for deleting by custom orderId
adminRouter.route("/:orderId").delete(authenticate, authorize("admin", "orders.delete"), deleteOrder);

adminRouter
  .route("/:id/status")
  .put(
    authenticate,
    authorize("admin", "employee", "manager", "orders.update_status"),
    validateUpdateOrderStatus,
    updateOrderStatus,
  );

module.exports = { publicRouter, adminRouter };
