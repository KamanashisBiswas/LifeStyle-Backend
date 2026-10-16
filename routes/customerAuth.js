/**
 * ============================================================
 * routes/customerAuth.js — Customer Authentication Routes
 * ============================================================
 * Base path: /api/customer
 *
 * Public Routes (token দরকার নেই):
 *  POST /api/customer/send-otp           → OTP পাঠানো
 *  POST /api/customer/verify-otp         → OTP verify
 *  POST /api/customer/register           → নতুন customer রেজিস্ট্রেশন
 *  POST /api/customer/login              → লগিন
 *  POST /api/customer/send-forgot-otp    → পাসওয়ার্ড ভুলে গেলে OTP
 *  POST /api/customer/reset-password     → নতুন পাসওয়ার্ড সেট
 *
 * Private Routes (authenticateCustomer middleware দরকার):
 *  GET  /api/customer/profile            → নিজের profile
 *  PUT  /api/customer/profile            → profile update
 *  POST /api/customer/change-password    → password নতুন করা
 *  POST /api/customer/add-address        → ঠিকানা যোগ
 *  PUT  /api/customer/address/:id        → ঠিকানা update
 *  DELETE /api/customer/address/:id      → ঠিকানা মুছে ফেলা
 *
 * Admin Routes (authenticate + authorize):
 *  GET  /api/customer/all                → সব customers
 *  GET  /api/customer/:id                → নির্দিষ্ট customer
 *  DELETE /api/customer/:id              → customer মুছে ফেলা
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();

const {
  sendOtp,
  verifyOtp,
  sendLoginOtp,
  verifyLoginOtp,
  registerCustomer,
  loginCustomer,
  getCustomerProfile,
  updateCustomerProfile,
  changeCustomerPassword,
  getAllCustomers,
  getCustomerByCustomId,
  deleteCustomerByCustomId,
  sendForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetCustomerPassword,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  updateCustomerByAdmin,
  getMergedCustomers,
  getCustomerByPhone,
  sendBulkSmsToCustomers,
} = require("../controllers/customerAuthController");

const {
  validateSendOtp,
  validateVerifyOtp,
  validateRegisterCustomer,
  validateLoginCustomer,
  validateUpdateProfile,
  validateChangePassword,
} = require("../validations/customerValidation");

const {
  authenticateCustomer,
  authenticate, // Import the general authenticate middleware
  authorize,
} = require("../middleware/auth");

// Public routes
publicRouter.post("/send-otp", validateSendOtp, sendOtp);
publicRouter.post("/verify-otp", validateVerifyOtp, verifyOtp);
publicRouter.post("/login-otp/send", sendLoginOtp);   // OTP-based login: send
publicRouter.post("/login-otp/verify", verifyLoginOtp); // OTP-based login: verify & get token
publicRouter.post("/register", validateRegisterCustomer, registerCustomer);
publicRouter.post("/login", validateLoginCustomer, loginCustomer);
publicRouter.post("/forgot-password/send-otp", sendForgotPasswordOtp);
publicRouter.post("/forgot-password/verify-otp", verifyForgotPasswordOtp);
publicRouter.post("/forgot-password/reset", resetCustomerPassword);

// Private customer routes (requires login)
publicRouter.get("/profile", authenticateCustomer, getCustomerProfile);
publicRouter.put(
  "/profile",
  authenticateCustomer,
  validateUpdateProfile,
  updateCustomerProfile,
);
publicRouter.put(
  "/change-password",
  authenticateCustomer,
  validateChangePassword,
  changeCustomerPassword,
);

// Address Management Routes
publicRouter.post("/addresses", authenticateCustomer, addAddress);
publicRouter.put("/addresses/:addressId", authenticateCustomer, updateAddress);
publicRouter.delete("/addresses/:addressId", authenticateCustomer, deleteAddress);
publicRouter.patch(
  "/addresses/:addressId/default",
  authenticateCustomer,
  setDefaultAddress,
);

// Admin, employee, or manager routes
adminRouter.get(
  "/",
  authenticate, // Use 'authenticate' for user roles
  authorize("admin", "employee", "manager", "customers.view", "pos.sell", "orders.create"),
  getAllCustomers,
);
adminRouter.get(
  "/merged-list",
  authenticate,
  authorize("admin", "employee", "manager", "customers.view"),
  getMergedCustomers
);
adminRouter.get(
  "/by-phone/:phone",
  authenticate,
  authorize("admin", "employee", "manager", "salesman", "customers.view", "pos.sell", "orders.create"),
  getCustomerByPhone
);
adminRouter.post(
  "/send-bulk-sms",
  authenticate,
  authorize("admin", "customers.sms"),
  sendBulkSmsToCustomers
);

adminRouter.get(
  "/:customId",
  authenticate, // Use 'authenticate' for user roles
  authorize("admin", "employee", "manager", "customers.view"),
  getCustomerByCustomId,
);

// Route to update a customer (Admin edits all, Employee edits VIP, Manager edits DOB only)
adminRouter.put(
  "/:customId",
  authenticate,
  authorize("admin", "employee", "manager", "customers.edit", "customers.vip_toggle"),
  updateCustomerByAdmin,
);

// Admin only or customers.delete route
adminRouter.delete(
  "/:customId",
  authenticate,
  authorize("admin", "customers.delete"),
  deleteCustomerByCustomId,
);

module.exports = { publicRouter, adminRouter };
