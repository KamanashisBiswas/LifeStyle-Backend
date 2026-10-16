/**
 * ============================================================
 * controllers/customerAuthController.js — Customer Authentication
 * ============================================================
 * Customer website ঊর user registration, login ও profile management handle করে।
 * OTP (One Time Password) ভিত্তিক phone নম্বার দিয়ে registration হয়।
 *
 * API Endpoints:
 *  POST /api/customer/send-otp         → sendOtp()         — phone নম্বারে OTP SMS পাঠায়
 *  POST /api/customer/verify-otp       → verifyOtp()       — OTP code যাচাই করে
 *  POST /api/customer/register         → registerCustomer() — OTP confirm হলে account তৈরি
 *  POST /api/customer/login            → loginCustomer()   — phone+password দিয়ে login
 *  GET  /api/customer/profile          → getProfile()      — লগিন customer ঊর profile
 *  PUT  /api/customer/profile          → updateProfile()   — profile update
 *  POST /api/customer/add-address      → addAddress()      — নতুন ঠিকানা যোগ করা
 *  PUT  /api/customer/address/:id      → updateAddress()   — ঠিকানা update
 *  DELETE /api/customer/address/:id    → deleteAddress()   — ঠিকানা মুছে ফেলা
 *  POST /api/customer/change-password  → changePassword()  — password পরিবর্তন
 *  (Admin) GET /api/customer/all       → getAllCustomers()  — সব customer দেখা
 *
 * OTP স্টোরেজ:
 *  OTP সাময়িকভাবে memory Map (রাম) ঊ রাখা হয় (5 মিনিট মেয়াদী)
 *  Server restart হলে সব OTP মুছে যায় — production ঊর জন্য Redis ব্যবহার বিবেচনা করা যায়
 * ============================================================
 */

const mongoose = require("mongoose");
const axios = require("axios");
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const { generateToken } = require("../utils/jwt");
const asyncHandler = require("../utils/asyncHandler");

// OTP সাময়িকভাবে Map ঊ সাভ করা হয় — key: phone, value: { otp, expires, verified }
const otpStore = new Map();

/**
 * @desc    Send OTP to a customer's phone number
 * @route   POST /api/customer/send-otp
 * @access  Public
 */
exports.sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^(?:\+88|88)?(01[3-9]\d{8})$/.test(phone)) {
    return res
      .status(400)
      .json({ message: "Please provide a valid Bangladeshi phone number." });
  }

  const existingCustomer = await Customer.findOne({ phone, password: { $exists: true, $ne: "N/A" } });
  if (existingCustomer) {
    return res
      .status(400)
      .json({ message: "A customer with this phone number already exists." });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const message = `Your LifeStyle verification code is ${otp}. It is valid for 5 minutes. Visit: https://shoppersperklifestyle.com/`;

  const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
    process.env.BULK_SMS_API_KEY
  }&senderid=${
    process.env.BULK_SMS_SENDER_ID
  }&number=${phone}&message=${encodeURIComponent(message)}`;

  const response = await axios.get(apiUrl);
  const responseCode = response?.data?.response_code;

  if (responseCode === 202) {
    // Store OTP with a 5-minute expiry
    otpStore.set(phone, { otp, expires: Date.now() + 5 * 60 * 1000 });
    res
      .status(200)
      .json({ success: true, message: `OTP sent successfully to ${phone}.` });
  } else {
    console.error("BulkSMS API Error:", response.data);
    res
      .status(500)
      .json({ message: "Failed to send OTP due to a provider error." });
  }
});

/**
 * @desc    Verify OTP for a customer's phone number
 * @route   POST /api/customer/verify-otp
 * @access  Public
 */
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res
      .status(400)
      .json({ message: "Phone number and OTP are required." });
  }

  const storedOtpData = otpStore.get(phone);

  if (!storedOtpData) {
    return res.status(400).json({
      message: "No OTP found for this phone number. Please request a new OTP.",
    });
  }

  if (storedOtpData.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP. Please try again." });
  }

  if (Date.now() > storedOtpData.expires) {
    otpStore.delete(phone);
    return res
      .status(400)
      .json({ message: "OTP has expired. Please request a new OTP." });
  }

  // Mark OTP as verified but keep it for registration
  otpStore.set(phone, { ...storedOtpData, verified: true });

  res.status(200).json({
    success: true,
    message:
      "OTP verified successfully. You can now complete your registration.",
  });
});

/**
 * @desc    Send OTP for existing customer login
 * @route   POST /api/customer/login-otp/send
 * @access  Public
 */
exports.sendLoginOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^(?:\+88|88)?(01[3-9]\d{8})$/.test(phone)) {
    return res
      .status(400)
      .json({ message: "Please provide a valid Bangladeshi phone number." });
  }

  const customer = await Customer.findOne({ phone });
  if (!customer) {
    return res.status(404).json({
      message: "No account found with this phone number. Please register first.",
    });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const message = `Your Shopper's Perk Lifestyle login code is ${otp}. Valid for 5 minutes. Do not share with anyone.`;

  const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
    process.env.BULK_SMS_API_KEY
  }&senderid=${
    process.env.BULK_SMS_SENDER_ID
  }&number=${phone}&message=${encodeURIComponent(message)}`;

  const response = await axios.get(apiUrl);
  const responseCode = response?.data?.response_code;

  if (responseCode === 202) {
    otpStore.set(`login_${phone}`, { otp, expires: Date.now() + 5 * 60 * 1000 });
    res.status(200).json({ success: true, message: `OTP sent to ${phone}.` });
  } else {
    console.error("BulkSMS API Error:", response.data);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
});

/**
 * @desc    Verify OTP and login existing customer
 * @route   POST /api/customer/login-otp/verify
 * @access  Public
 */
exports.verifyLoginOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ message: "Phone number and OTP are required." });
  }

  const storedOtpData = otpStore.get(`login_${phone}`);

  if (!storedOtpData) {
    return res.status(400).json({
      message: "No OTP found. Please request a new OTP.",
    });
  }

  if (storedOtpData.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP. Please try again." });
  }

  if (Date.now() > storedOtpData.expires) {
    otpStore.delete(`login_${phone}`);
    return res.status(400).json({ message: "OTP has expired. Please request a new one." });
  }

  const customer = await Customer.findOne({ phone });
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }

  otpStore.delete(`login_${phone}`);

  const token = generateToken(customer);
  res.json({
    _id: customer._id,
    customId: customer.customId,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    dob: customer.dob,
    addresses: customer.addresses,
    rewardPoints: customer.rewardPoints || 0,
    isVip: Boolean(customer.isVip),
    token,
  });
});

/**
 * @desc    Register a new customer
 * @route   POST /api/customer/register
 * @access  Public
 */
exports.registerCustomer = asyncHandler(async (req, res) => {
  const { name, email, phone, password, dob, otp } = req.body;

  if (!name || !phone || !otp) {
    return res
      .status(400)
      .json({ message: "Name, phone, and OTP are required." });
  }

  const storedOtpData = otpStore.get(phone);

  if (!storedOtpData || storedOtpData.otp !== otp) {
    return res.status(400).json({ message: "Invalid or incorrect OTP." });
  }

  if (Date.now() > storedOtpData.expires) {
    otpStore.delete(phone);
    return res
      .status(400)
      .json({ message: "OTP has expired. Please try again." });
  }

  if (!storedOtpData.verified) {
    return res
      .status(400)
      .json({ message: "Please verify your OTP before registering." });
  }

  const existing = await Customer.findOne({ phone, password: { $exists: true, $ne: "N/A" } });
  if (existing) {
    return res
      .status(400)
      .json({ message: "A customer with this phone number already exists." });
  }

  // Handle email: trim and set to null if empty
  let emailToSave = null;
  if (email && email.trim() !== "") {
    emailToSave = email.trim();
    // Check for existing email manually to provide a clear error message
    const existingEmail = await Customer.findOne({ email: emailToSave });
    if (existingEmail) {
      return res.status(400).json({ message: "Email already exists." });
    }
  }

  const normName = name.trim();
  let customer = await Customer.findOne({ phone });

  if (customer) {
    customer.name = normName;
    if (password) customer.password = password;
    if (emailToSave) customer.email = emailToSave;
    if (dob) customer.dob = dob;
    await customer.save();
  } else {
    customer = await Customer.create({
      name: normName,
      email: emailToSave,
      phone,
      password: password || undefined,
      dob: dob || undefined,
    });
  }

  otpStore.delete(phone); // Clean up OTP

  const token = generateToken(customer);
  res.status(201).json({
    _id: customer._id,
    customId: customer.customId,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    dob: customer.dob,
    rewardPoints: customer.rewardPoints || 0,
    isVip: Boolean(customer.isVip),
    addresses: customer.addresses || [],
    token,
  });
});

/**
 * @desc    Login a customer
 * @route   POST /api/customer/login
 * @access  Public
 */
exports.loginCustomer = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  const customer = await Customer.findOne({ phone, password: { $exists: true, $ne: "N/A" } }).select("+password");

  if (customer && (await customer.matchPassword(password))) {
    const token = generateToken(customer);
    res.json({
      _id: customer._id,
      customId: customer.customId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      dob: customer.dob,
      addresses: customer.addresses,
      rewardPoints: customer.rewardPoints || 0,
      isVip: Boolean(customer.isVip),
      token,
    });
  } else {
    res.status(401).json({ message: "Invalid phone number or password" });
  }
});

/**
 * @desc    Get current logged in customer's profile
 * @route   GET /api/customer/profile
 * @access  Private
 */
exports.getCustomerProfile = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);

  if (customer) {
    res.json({
      _id: customer._id,
      customId: customer.customId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      dob: customer.dob,
      addresses: customer.addresses,
      rewardPoints: customer.rewardPoints || 0,
      isVip: Boolean(customer.isVip),
    });
  } else {
    res.status(404).json({ message: "Customer not found" });
  }
});

/**
 * @desc    Update customer profile
 * @route   PUT /api/customer/profile
 * @access  Private
 */
exports.updateCustomerProfile = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);

  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  // Check if email is being changed and if it already exists
  if (req.body.email && req.body.email !== customer.email) {
    const emailExists = await Customer.findOne({ email: req.body.email });
    if (emailExists) {
      return res.status(400).json({ message: "Email already in use" });
    }
  }

  customer.name = req.body.name || customer.name;
  // Handle empty string for email to set it to null
  customer.email =
    req.body.email === "" ? null : req.body.email || customer.email;
  customer.dob = req.body.dob || customer.dob;

  const updatedCustomer = await customer.save();

  // Return only the updated customer data, not the token
  res.json({
    _id: updatedCustomer._id,
    customId: updatedCustomer.customId,
    name: updatedCustomer.name,
    email: updatedCustomer.email,
    phone: updatedCustomer.phone,
    dob: updatedCustomer.dob,
    addresses: updatedCustomer.addresses,
    rewardPoints: updatedCustomer.rewardPoints || 0,
    isVip: Boolean(updatedCustomer.isVip),
  });
});

/**
 * @desc    Change customer password
 * @route   PUT /api/customer/change-password
 * @access  Private
 */
exports.changeCustomerPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const customer = await Customer.findById(req.customer.id).select("+password");

  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  if (!(await customer.matchPassword(currentPassword))) {
    return res.status(401).json({ message: "Incorrect current password" });
  }

  customer.password = newPassword;
  await customer.save();

  res.json({ message: "Password updated successfully" });
});

/**
 * @desc    Update customer profile by Admin/Employee
 * @route   PUT /api/customer/:customId
 * @access  Private (Admin, Employee)
 */
exports.updateCustomerByAdmin = asyncHandler(async (req, res) => {
  const { customId } = req.params;
  const { name, email, phone, dob, addresses, isVip } = req.body;

  const customer = await Customer.findOne({
    $or: [
      { customId: customId },
      ...(mongoose.isValidObjectId(customId) ? [{ _id: customId }] : []),
      { phone: customId },
    ],
  });

  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  const userRole = (req.user?.role || "").toLowerCase();

  // VIP Customer Toggle (Admin, Employee, and Manager can toggle VIP status if customer has >= 50 reward points)
  if (isVip !== undefined && ["admin", "employee", "manager"].includes(userRole)) {
    const targetIsVip = Boolean(isVip);
    if (targetIsVip && (customer.rewardPoints || 0) < 50) {
      return res.status(400).json({
        success: false,
        message: `Customer must have at least 50 reward points to be marked as VIP (Current: ${customer.rewardPoints || 0} Pts)`,
      });
    }
    customer.isVip = targetIsVip;
  }

  if (userRole === "manager") {
    // Manager is ONLY allowed to edit Date of Birth (DOB)
    if (dob !== undefined) {
      customer.dob = dob;
    }
  } else if (userRole === "employee") {
    // Employee can edit isVip (handled above)
    if (isVip === undefined && name === undefined && email === undefined && phone === undefined && dob === undefined && addresses === undefined) {
      // Nothing else
    }
  } else if (userRole === "admin") {
    // Admin can edit all fields (Name, Email, Phone, DOB, Addresses, isVip)
    if (email !== undefined) {
      const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (cleanEmail && cleanEmail !== customer.email) {
        const emailExists = await Customer.findOne({
          email: cleanEmail,
          _id: { $ne: customer._id },
        });
        if (emailExists) {
          return res.status(400).json({ message: "Email already in use by another customer" });
        }
        customer.email = cleanEmail;
      } else if (!cleanEmail) {
        customer.email = undefined;
      }
    }

    if (phone && phone !== customer.phone) {
      const phoneExists = await Customer.findOne({
        phone,
        _id: { $ne: customer._id },
      });
      if (phoneExists) {
        return res.status(400).json({ message: "Phone number already in use by another customer" });
      }
      customer.phone = phone;
    }

    customer.name = name ?? customer.name;
    if (dob !== undefined) {
      customer.dob = dob ? dob : undefined;
    }

    if (addresses) {
      customer.addresses = addresses;
      customer.markModified("addresses");
    }
  } else {
    return res.status(403).json({ message: "Access denied. Insufficient permissions." });
  }

  const updatedCustomer = await customer.save();

  res.json({
    success: true,
    message: "Customer updated successfully",
    data: updatedCustomer,
  });
});

/**
 * @desc    Add a new address for a customer
 * @route   POST /api/customer/addresses
 * @access  Private
 */
exports.addAddress = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  // Enforce a maximum of 2 addresses
  if (customer.addresses.length >= 2) {
    return res
      .status(400)
      .json({ message: "You can only have a maximum of 2 saved addresses." });
  }

  const newAddress = req.body;

  // If the new address is set as default, unset all other defaults
  if (newAddress.isDefault) {
    customer.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  customer.addresses.push(newAddress);
  await customer.save();

  res.status(201).json(customer);
});

/**
 * @desc    Update an existing address
 * @route   PUT /api/customer/addresses/:addressId
 * @access  Private
 */
exports.updateAddress = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  const address = customer.addresses.id(req.params.addressId);
  if (!address) {
    return res.status(404).json({ message: "Address not found" });
  }

  // If the updated address is being set to default, unset all others first
  if (req.body.isDefault) {
    customer.addresses.forEach((addr) => {
      addr.isDefault = false;
    });
  }

  // Update fields
  Object.assign(address, req.body);

  await customer.save();
  res.json(customer);
});

/**
 * @desc    Delete an address
 * @route   DELETE /api/customer/addresses/:addressId
 * @access  Private
 */
exports.deleteAddress = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  customer.addresses.pull({ _id: req.params.addressId });
  await customer.save();

  res.json(customer);
});

/**
 * @desc    Set an address as default
 * @route   PATCH /api/customer/addresses/:addressId/default
 * @access  Private
 */
exports.setDefaultAddress = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer.id);
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  const targetAddress = customer.addresses.id(req.params.addressId);
  if (!targetAddress) {
    return res.status(404).json({ message: "Address not found" });
  }

  // Unset all other defaults, regardless of type
  customer.addresses.forEach((addr) => {
    addr.isDefault = false;
  });

  // Set the target address as default
  targetAddress.isDefault = true;

  await customer.save();
  res.json(customer);
});

// Get all customers (admin only)
exports.getAllCustomers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, search } = req.query;

  let query = {};
  if (search) {
    const regex = new RegExp(search, "i");
    query = {
      $or: [{ name: regex }, { phone: regex }],
    };
  }

  // pagination=false হলে সব customers একসাথে return করা হবে
  if (pagination === "false") {
    const customers = await Customer.find(query)
      .select("-password")
      .sort({ updatedAt: -1, createdAt: -1 });
    return res.json({
      success: true,
      data: customers,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        total: customers.length,
        limit: customers.length,
      },
    });
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const customers = await Customer.find(query)
    .select("-password")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Customer.countDocuments(query);

  res.json({
    success: true,
    data: customers,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      total,
      limit: parseInt(limit),
    },
  });
});

// Get single customer by customId (admin only)
exports.getCustomerByCustomId = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({
    customId: req.params.customId,
  }).select("-password");
  if (!customer) return res.status(404).json({ message: "Customer not found" });
  res.json(customer);
});

// Delete customer by customId (admin only)
exports.deleteCustomerByCustomId = asyncHandler(async (req, res) => {
  const id = req.params.customId;
  const isObjectId = mongoose.isValidObjectId(id);
  const deleted = await Customer.findOneAndDelete({
    $or: [
      { customId: id },
      ...(isObjectId ? [{ _id: id }] : []),
      { phone: id },
    ],
  });
  if (!deleted) return res.status(404).json({ message: "Customer not found" });
  res.json({ message: "Customer deleted successfully" });
});

/**
 * @desc    Send OTP for password reset
 * @route   POST /api/customer/forgot-password/send-otp
 * @access  Public
 */
exports.sendForgotPasswordOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const customer = await Customer.findOne({ phone, password: { $exists: true, $ne: "N/A" } });
  if (!customer) {
    return res
      .status(404)
      .json({ message: "Customer not found with this phone." });
  }
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const message = `Your LifeStyle password reset code is ${otp}. It is valid for 5 minutes. Visit: https://shoppersperklifestyle.com/`;

  const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
    process.env.BULK_SMS_API_KEY
  }&senderid=${
    process.env.BULK_SMS_SENDER_ID
  }&number=${phone}&message=${encodeURIComponent(message)}`;

  const response = await axios.get(apiUrl);
  const responseCode = response?.data?.response_code;

  if (responseCode === 202) {
    otpStore.set(phone, {
      otp,
      expires: Date.now() + 5 * 60 * 1000,
      for: "reset",
    });
    res
      .status(200)
      .json({ success: true, message: "OTP sent for password reset." });
  } else {
    console.error("BulkSMS API Error:", response.data);
    res
      .status(500)
      .json({ message: "Failed to send OTP due to a provider error." });
  }
});

/**
 * @desc    Verify OTP for password reset
 * @route   POST /api/customer/forgot-password/verify-otp
 * @access  Public
 */
exports.verifyForgotPasswordOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;
  const stored = otpStore.get(phone);
  if (!stored || stored.otp !== otp || stored.for !== "reset") {
    return res.status(400).json({ message: "Invalid OTP." });
  }
  if (Date.now() > stored.expires) {
    otpStore.delete(phone);
    return res.status(400).json({ message: "OTP expired." });
  }
  otpStore.set(phone, { ...stored, verified: true });
  res.status(200).json({ success: true, message: "OTP verified." });
});

/**
 * @desc    Reset password after OTP verification
 * @route   POST /api/customer/forgot-password/reset
 * @access  Public
 */
exports.resetCustomerPassword = asyncHandler(async (req, res) => {
  const { phone, otp, password } = req.body;
  const stored = otpStore.get(phone);
  if (
    !stored ||
    !stored.verified ||
    stored.otp !== otp ||
    stored.for !== "reset"
  ) {
    return res.status(400).json({ message: "OTP not verified." });
  }
  const customer = await Customer.findOne({ phone, password: { $exists: true, $ne: "N/A" } });
  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }
  customer.password = password;
  await customer.save();
  otpStore.delete(phone);
  res
    .status(200)
    .json({ success: true, message: "Password reset successful." });
});

/**
 * @desc    Get merged online and shop customers with pagination, search, and type filtering
 * @route   GET /api/admin/customer/merged-list
 * @access  Private (Admin, Employee, Manager)
 */
exports.getMergedCustomers = asyncHandler(async (req, res) => {
  // 1. Fetch all customers from DB
  const allDbCustomers = await Customer.find().select("+password").lean();

  // 2. Aggregate online orders total spent and count
  const onlineSpend = await Order.aggregate([
    { $match: { orderType: "online" } },
    { $group: {
        _id: "$customer",
        total: { $sum: "$totalAmount" },
        count: { $sum: 1 }
    } }
  ]);
  const onlineSpendMap = {};
  const onlineCountMap = {};
  onlineSpend.forEach(s => {
    if (s._id) {
      onlineSpendMap[s._id.toString()] = s.total;
      onlineCountMap[s._id.toString()] = s.count;
    }
  });

  // 3. Aggregate shop orders total spent by name + phone
  const shopSpend = await Order.aggregate([
    { $match: { orderType: "shop" } },
    { $group: {
        _id: {
          customer: "$customer",
          name: { $trim: { input: { $toLower: "$customerName" } } },
          phone: { $trim: { input: "$phone" } }
        },
        total: { $sum: "$totalAmount" },
        count: { $sum: 1 },
        createdAt: { $first: "$createdAt" },
        orderId: { $first: "$orderId" },
        _orderId: { $first: "$_id" }
    } }
  ]);

  // 4. Merge online and shop customers in memory
  const customerMap = new Map();

  allDbCustomers.forEach(c => {
    const phone = c.phone?.trim() || "N/A";
    const name = c.name?.trim() || "Unknown Customer";
    const key = `${name.toLowerCase()}-${phone}`;
    const onlineAmount = Number(onlineSpendMap[c._id.toString()] || 0);
    const hasOnlineOrders = onlineAmount > 0 || Boolean(onlineCountMap[c._id.toString()]);
    // Online registered account: must be registered from website with an online profile, NOT auto-created by POS
    const isOnlineAccount = c.registeredFrom === "website" || (c.registeredFrom !== "pos" && c.email && c.password && c.password !== "N/A");

    const types = [];
    if (hasOnlineOrders || isOnlineAccount) {
      types.push("Online");
    }

    customerMap.set(key, {
      _id: c._id,
      customId: c.customId || c._id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      rewardPoints: c.rewardPoints || 0,
      isVip: Boolean(c.isVip),
      dob: c.dob,
      type: types,
      createdAt: c.createdAt,
      onlineSpent: onlineAmount,
      shopSpent: 0,
      totalSpent: onlineAmount,
      addresses: c.addresses || []
    });
  });

  shopSpend.forEach(s => {
    const name = s._id.name || "Walk-in Customer";
    const phone = s._id.phone || "N/A";
    const key = `${name.toLowerCase()}-${phone}`;
    const shopAmount = Number(s.total || 0);

    if (customerMap.has(key)) {
      const existing = customerMap.get(key);
      if (!existing.type.includes("Shop")) {
        existing.type.push("Shop");
      }
      existing.shopSpent = (existing.shopSpent || 0) + shopAmount;
      existing.totalSpent = (existing.onlineSpent || 0) + existing.shopSpent;
    } else {
      customerMap.set(key, {
        _id: s._id.customer || `shop-${s._orderId}`,
        customId: `SHOP-${s.orderId || Math.floor(Math.random() * 10000)}`,
        name: s._id.name ? (s._id.name.charAt(0).toUpperCase() + s._id.name.slice(1)) : "Walk-in Customer",
        email: null,
        phone: phone,
        rewardPoints: 0,
        isVip: false,
        dob: null,
        type: ["Shop"],
        createdAt: s.createdAt,
        onlineSpent: 0,
        shopSpent: shopAmount,
        totalSpent: shopAmount,
        addresses: []
      });
    }
  });

  const allMergedCustomers = Array.from(customerMap.values());

  // Ensure every customer has at least one valid type
  allMergedCustomers.forEach((c) => {
    if (!c.type || c.type.length === 0) {
      if ((c.shopSpent || 0) > 0) {
        c.type = ["Shop"];
      } else if ((c.onlineSpent || 0) > 0) {
        c.type = ["Online"];
      } else {
        c.type = c.registeredFrom === "pos" ? ["Shop"] : ["Online"];
      }
    }
  });

  const isBirthdayToday = (dobStr) => {
    if (!dobStr) return false;
    const dob = new Date(dobStr);
    if (isNaN(dob.getTime())) return false;
    const today = new Date();
    return dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate();
  };

  const isBirthdayUpcoming = (dobStr) => {
    if (!dobStr) return false;
    const dob = new Date(dobStr);
    if (isNaN(dob.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bdayThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    bdayThisYear.setHours(0, 0, 0, 0);

    if (bdayThisYear < today) {
      bdayThisYear.setFullYear(today.getFullYear() + 1);
    }

    const diffTime = bdayThisYear.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 1 && diffDays <= 7;
  };

  allMergedCustomers.forEach((c) => {
    c.isBirthdayToday = isBirthdayToday(c.dob);
    c.isBirthdayUpcoming = !c.isBirthdayToday && isBirthdayUpcoming(c.dob);
  });

  const todayBirthdaysCount = allMergedCustomers.filter((c) => c.isBirthdayToday).length;
  const upcomingBirthdaysCount = allMergedCustomers.filter((c) => c.isBirthdayUpcoming).length;

  // 5. Calculate Top 3 Spenders overall
  const sortedBySpend = [...allMergedCustomers].sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0));
  const top3Customers = sortedBySpend.slice(0, 3);

  // 6. Apply filter and query
  const { q, searchQuery, searchType, birthdayFilter, page = 1, limit = 10 } = req.query;
  const queryVal = q || searchQuery;
  let filteredCustomers = allMergedCustomers;

  if (queryVal) {
    const query = queryVal.toLowerCase();
    filteredCustomers = filteredCustomers.filter(c => 
      c.name?.toLowerCase().includes(query) || 
      c.phone?.includes(query)
    );
  }

  if (searchType && searchType !== "all") {
    if (searchType === "online") {
      filteredCustomers = filteredCustomers.filter(c => c.type.includes("Online"));
    } else if (searchType === "shop") {
      filteredCustomers = filteredCustomers.filter(c => c.type.includes("Shop"));
    } else if (searchType === "both") {
      filteredCustomers = filteredCustomers.filter(c => c.type.includes("Online") && c.type.includes("Shop"));
    }
  }

  if (birthdayFilter && birthdayFilter !== "all") {
    if (birthdayFilter === "today") {
      filteredCustomers = filteredCustomers.filter(c => c.isBirthdayToday);
    } else if (birthdayFilter === "upcoming") {
      filteredCustomers = filteredCustomers.filter(c => c.isBirthdayUpcoming);
    }
  }

  // 7. Sort filtered customers by Joined On (newest first)
  filteredCustomers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 8. Calculate filtered stats
  const totalFiltered = filteredCustomers.length;
  const onlineFiltered = filteredCustomers.filter(c => c.type.includes("Online")).length;
  const shopFiltered = filteredCustomers.filter(c => c.type.includes("Shop")).length;

  // 9. Paginate (or return all if pagination=false)
  const isAll = req.query.pagination === "false";
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const totalPages = isAll ? 1 : (Math.ceil(totalFiltered / limitNum) || 1);
  const paginatedCustomers = isAll ? filteredCustomers : filteredCustomers.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.status(200).json({
    success: true,
    data: paginatedCustomers,
    pagination: {
      currentPage: isAll ? 1 : pageNum,
      totalPages,
      totalCustomers: totalFiltered,
      limit: isAll ? totalFiltered : limitNum
    },
    stats: {
      total: totalFiltered,
      online: onlineFiltered,
      shop: shopFiltered,
      todayBirthdays: todayBirthdaysCount,
      upcomingBirthdays: upcomingBirthdaysCount,
    },
    top3Customers
  });
});

/**
 * @desc    Get customer by phone number
 */
exports.getCustomerByPhone = asyncHandler(async (req, res) => {
  const { phone } = req.params;
  const cleanedPhone = phone.trim();
  
  const customer = await Customer.findOne({ phone: cleanedPhone }).lean();
  
  // Fetch Order sum matching this phone across all non-cancelled orders
  const orderSumResult = await Order.aggregate([
    { 
      $match: { 
        $or: [
          { phone: cleanedPhone },
          { customerPhone: cleanedPhone },
          ...(customer ? [{ customer: customer._id }] : [])
        ],
        status: { $nin: ["cancelled", "returned"] }
      } 
    },
    {
      $group: {
        _id: null,
        totalSpent: { $sum: { $ifNull: ["$totalAmount", "$total"] } }
      }
    }
  ]);
  
  const totalSpent = orderSumResult.length > 0 ? orderSumResult[0].totalSpent : 0;
  
  // If customer or any order history exists, return it
  if (customer || totalSpent > 0) {
    const resultData = {
      _id: customer ? customer._id : `shop-${cleanedPhone}`,
      customId: customer ? customer.customId : null,
      name: customer ? customer.name : "Walk-in Customer",
      phone: cleanedPhone,
      rewardPoints: customer ? (customer.rewardPoints || 0) : 0,
      isVip: Boolean(customer?.isVip),
      totalSpent: totalSpent,
      addresses: customer ? (customer.addresses || []) : []
    };
    return res.status(200).json({
      success: true,
      data: [resultData]
    });
  }

  res.status(200).json({
    success: true,
    data: []
  });
});

/**
 * @desc    Send bulk promotional SMS to selected or all customer numbers
 * @route   POST /api/admin/customer/send-bulk-sms
 * @access  Private (Admin, Employee)
 */
exports.sendBulkSmsToCustomers = asyncHandler(async (req, res) => {
  const { phoneNumbers, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: "Please write an SMS message body.",
    });
  }

  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please select at least one customer phone number.",
    });
  }

  // Filter and normalize phone numbers (Remove duplicates & format to 11 digits)
  const validPhones = Array.from(
    new Set(
      phoneNumbers
        .map((p) => String(p).trim().replace(/[^\d+]/g, ""))
        .map((p) => {
          if (p.startsWith("+880")) return p.slice(3);
          if (p.startsWith("880")) return p.slice(2);
          return p;
        })
        .filter((p) => p && p.length === 11 && p.startsWith("01"))
    )
  );

  if (validPhones.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No valid 11-digit Bangladeshi mobile numbers found.",
    });
  }

  const apiKey = process.env.BULK_SMS_API_KEY;
  const senderId = process.env.BULK_SMS_SENDER_ID;

  if (!apiKey || !senderId) {
    return res.status(500).json({
      success: false,
      message: "Bulk SMS gateway credentials are not configured on the server.",
    });
  }

  // bulksmsbd supports comma separated numbers: "017...,018..."
  const chunkSize = 50;
  let totalSent = 0;
  const errors = [];

  for (let i = 0; i < validPhones.length; i += chunkSize) {
    const chunk = validPhones.slice(i, i + chunkSize);
    const numbersParam = chunk.join(",");
    const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${apiKey}&senderid=${senderId}&number=${numbersParam}&message=${encodeURIComponent(
      message.trim()
    )}`;

    try {
      const response = await axios.get(apiUrl);
      if (response?.data?.response_code === 202 || response?.data?.success) {
        totalSent += chunk.length;
      } else {
        console.error("Bulk SMS provider response error:", response?.data);
        errors.push(response?.data?.error_message || response?.data?.message || "Failed to send SMS batch");
      }
    } catch (err) {
      console.error("Bulk SMS error on batch:", err?.response?.data || err.message);
      errors.push(err?.response?.data?.message || err.message);
    }
  }

  if (totalSent === 0 && errors.length > 0) {
    return res.status(500).json({
      success: false,
      message: `Failed to send SMS: ${errors[0]}`,
    });
  }

  res.status(200).json({
    success: true,
    message: `Promotional SMS sent successfully to ${totalSent} customer(s)!`,
    totalSent,
    totalRequested: validPhones.length,
  });
});

