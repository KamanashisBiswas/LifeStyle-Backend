/**
 * ============================================================
 * controllers/authController.js — Admin/Employee Authentication
 * ============================================================
 * Admin ও Employee ঊর login, register, token refresh ও logout handle করে।
 *
 * API Endpoints:
 *  POST /api/auth/register  → register() — নতুন admin/employee আসা তৈরি
 *  POST /api/auth/login     → login()    — email+password দিয়ে login
 *  POST /api/auth/refresh   → refreshToken() — access token expire হলে নতুন token নিতে
 *  POST /api/auth/logout    → logout()   — database থেকে refresh token মুছে ফেলে
 *  GET  /api/auth/me        → getMe()   — logged in user ঊর profile দেখা
 *
 * Token flow:
 *  Login → accessToken (1d) + refreshToken (30d) পাওয়া যায়
 *  accessToken expire হলে refreshToken দিয়ে /api/auth/refresh করে নতুন token নেওয়া যায়
 *  Logout হলে database থেকে refreshToken মুছে দেওয়া হয়
 * ============================================================
 */

const User = require("../models/User");
const JWTUtil = require("../utils/jwt");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: "User already exists with this email",
    });
  }

  // Create user
  const user = await User.create({
    name,
    email,
    password,
  });

  // Generate tokens
  const tokens = JWTUtil.generateTokenPair(user._id, user.email, user.role);

  // Save refresh token to user
  user.refreshToken = tokens.refreshToken;
  await user.save();

  res.status(201).json({
    success: true,
    message: "User registered successfully",
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      tokens,
    },
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user and include password for comparison
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return res.status(401).json({
      success: false,
      errorType: "email",
      message: "Incorrect Email",
    });
  }

  // Check password
  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return res.status(401).json({
      success: false,
      errorType: "password",
      message: "Incorrect Password",
    });
  }

  // Generate tokens
  const tokens = JWTUtil.generateTokenPair(user._id, user.email, user.role);

  // Save refresh token and update last login
  user.refreshToken = tokens.refreshToken;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers["user-agent"];
  await user.updateLastLogin(ip, userAgent);

  // Log user login activity
  logActivity({
    user: user,
    action: "LOGIN",
    entityType: "User",
    entityId: user._id.toString(),
    description: `${user.name} logged into the system (${user.role})`,
    metadata: { role: user.role, ip }
  });

  const { getEffectivePermissionsForUser } = require("./roleController");
  const permissions = await getEffectivePermissionsForUser(user);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: permissions || [],
        lastLogin: user.lastLogin,
      },
      tokens,
    },
  });
});

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: "Refresh token is required",
    });
  }

  try {
    // Verify refresh token
    const decoded = JWTUtil.verifyToken(refreshToken);

    // Find user with this refresh token
    const user = await User.findOne({
      _id: decoded.id,
      refreshToken: refreshToken,
    }).select("+refreshToken");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Generate new tokens
    const tokens = JWTUtil.generateTokenPair(user._id, user.email, user.role);

    // Update refresh token in database
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: { tokens },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (user) {
    user.refreshToken = undefined;
    
    if (user.loginHistory && user.loginHistory.length > 0) {
      let latestSession = [...user.loginHistory].reverse().find((s) => !s.logoutTime);
      if (!latestSession) {
        latestSession = user.loginHistory[user.loginHistory.length - 1];
      }
      if (latestSession) {
        latestSession.logoutTime = new Date();
        const diffMs = latestSession.logoutTime - latestSession.loginTime;
        latestSession.workingHours = diffMs;
      }
    }
    
    await user.save();
  }

  // Log user logout activity
  logActivity({
    req,
    action: "LOGOUT",
    entityType: "User",
    entityId: req.user?.id || "",
    description: `${req.user?.name || "User"} logged out of the system`,
    metadata: { role: req.user?.role }
  });

  res.status(200).json({
    success: true,
    message: "Logout successful",
  });
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const { getEffectivePermissionsForUser } = require("./roleController");
  const permissions = await getEffectivePermissionsForUser(user);

  res.status(200).json({
    success: true,
    data: {
      user: {
        ...user.toObject(),
        permissions: permissions || [],
      },
    },
  });
});

// In-memory OTP storage for password reset
const staffOtpStore = new Map();

// Helper to normalize Bangladeshi phone numbers for robust matching
const normalizePhone = (phone) => {
  if (!phone) return "";
  let p = phone.toString().trim().replace(/[\s\-\(\)\+]/g, "");
  if (p.startsWith("880")) p = "0" + p.slice(3);
  if (p.startsWith("88")) p = p.slice(2);
  return p;
};

// @desc    Send OTP for staff password reset after verifying phone
// @route   POST /api/auth/forgot-password/send-otp
// @access  Public
const sendStaffForgotPasswordOtp = asyncHandler(async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.status(400).json({
      success: false,
      message: "Email address and registered phone number are required.",
    });
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+password");
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "No user account found with this email address.",
    });
  }

  const userPhoneNorm = normalizePhone(user.phone);
  const inputPhoneNorm = normalizePhone(phone);

  if (!userPhoneNorm || userPhoneNorm !== inputPhoneNorm) {
    return res.status(400).json({
      success: false,
      message: "The provided phone number does not match our records for this account.",
    });
  }

  // Generate 4-digit numeric OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const cacheKey = `staff_reset_${userPhoneNorm}`;

  staffOtpStore.set(cacheKey, {
    otp,
    email: user.email,
    phone: userPhoneNorm,
    userId: user._id.toString(),
    expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    verified: false,
  });

  const message = `Your ShoppersPerk LifeStyle password reset code is ${otp}. Valid for 5 minutes.`;
  let smsSent = false;

  if (process.env.BULK_SMS_API_KEY && process.env.BULK_SMS_SENDER_ID) {
    try {
      const axios = require("axios");
      const apiUrl = `https://bulksmsbd.net/api/smsapi?api_key=${
        process.env.BULK_SMS_API_KEY
      }&senderid=${
        process.env.BULK_SMS_SENDER_ID
      }&number=${userPhoneNorm}&message=${encodeURIComponent(message)}`;
      const response = await axios.get(apiUrl);
      if (response?.data?.response_code === 202) {
        smsSent = true;
      }
    } catch (err) {
      console.error("BulkSMS API Error for staff reset:", err.message);
    }
  }

  // Mask phone for response (e.g. 017****1234)
  const maskedPhone =
    userPhoneNorm.length >= 7
      ? userPhoneNorm.slice(0, 3) + "****" + userPhoneNorm.slice(-4)
      : userPhoneNorm;

  res.status(200).json({
    success: true,
    message: `Verification code sent to registered number ${maskedPhone}.`,
    phone: maskedPhone,
  });
});

// @desc    Verify OTP for staff password reset
// @route   POST /api/auth/forgot-password/verify-otp
// @access  Public
const verifyStaffForgotPasswordOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({
      success: false,
      message: "Phone number and OTP code are required.",
    });
  }

  const phoneNorm = normalizePhone(phone);
  const cacheKey = `staff_reset_${phoneNorm}`;
  const stored = staffOtpStore.get(cacheKey);

  if (!stored || stored.otp !== otp.toString().trim()) {
    return res.status(400).json({
      success: false,
      message: "Invalid or incorrect OTP code.",
    });
  }

  if (Date.now() > stored.expires) {
    staffOtpStore.delete(cacheKey);
    return res.status(400).json({
      success: false,
      message: "OTP code has expired. Please request a new one.",
    });
  }

  staffOtpStore.set(cacheKey, { ...stored, verified: true });

  res.status(200).json({
    success: true,
    message: "OTP verified successfully. You can now set your new password.",
  });
});

// @desc    Reset password with verified OTP
// @route   POST /api/auth/forgot-password/reset
// @access  Public
const resetStaffPassword = asyncHandler(async (req, res) => {
  const { phone, otp, newPassword } = req.body;

  if (!phone || !otp || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Phone, OTP, and new password are required.",
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters long.",
    });
  }

  const phoneNorm = normalizePhone(phone);
  const cacheKey = `staff_reset_${phoneNorm}`;
  const stored = staffOtpStore.get(cacheKey);

  if (!stored || !stored.verified || stored.otp !== otp.toString().trim()) {
    return res.status(400).json({
      success: false,
      message: "OTP verification is required before resetting password.",
    });
  }

  const user = await User.findById(stored.userId).select("+password");
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User account not found.",
    });
  }

  // Update password (pre-save middleware will hash it with bcrypt)
  user.password = newPassword;
  await user.save();

  // Invalidate OTP after successful reset
  staffOtpStore.delete(cacheKey);

  // Log user activity
  logActivity({
    req,
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user._id,
    description: `User '${user.name}' (${user.email}) reset password via phone OTP verification`,
    metadata: { email: user.email, role: user.role }
  });

  res.status(200).json({
    success: true,
    message: "Password reset successfully! You can now log in with your new password.",
  });
});

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  sendStaffForgotPasswordOtp,
  verifyStaffForgotPasswordOtp,
  resetStaffPassword,
};
