/**
 * ============================================================
 * controllers/userController.js — User Account Management
 * ============================================================
 * Admin/Employee/Salesman user account management handle করে।
 * শুধু Admin panel ঌদ্ধ authenticated user দ্বারা access।
 *
 * API Endpoints:
 *  PUT    /api/user/profile         → updateProfile()   — নিজের profile update
 *  PUT    /api/user/change-password → changePassword()  — password নতুন করা
 *  DELETE /api/user/account         → deleteAccount()   — নিজের account মুছে ফেলা
 *  GET    /api/user/all             → getAllUsers()     — Admin: সব users (pagination)
 *  GET    /api/user/profile         → getProfile()     — নিজের profile দেখা
 *  PUT    /api/user/:id/role        → updateUserRole() — Admin: অন্য user ঊর role change
 *  DELETE /api/user/:id             → deleteUser()     — Admin: অন্য user মুছে ফ৅লা
 *  POST   /api/user                 → createUser()     — Admin: নতুন user তৈরি
 *  PUT    /api/user/:id/profile-image → updateProfileImage() — profile ছবি update
 * ============================================================
 */

const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const {
  deleteImageFromCloudinary,
  extractPublicIdFromUrl,
} = require("../config/cloudinary");

// @desc    Update user profile
// @route   PUT /api/user/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    avatar,
    phone,
    nid,
    permanentAddress,
    dob,
    bloodGroup,
    emergencyContact,
  } = req.body;

  const userId = req.user.id || req.user._id;
  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const isAdmin = req.user.role === "admin";

  // Check if email is being changed and already exists
  if (email && email.toLowerCase() !== user.email?.toLowerCase()) {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser && existingUser._id.toString() !== userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }
  }

  if (name && typeof name === "string" && name.trim() !== "") {
    user.name = name.trim();
  }
  if (email && typeof email === "string" && email.trim() !== "") {
    user.email = email.trim().toLowerCase();
  }
  if (avatar !== undefined) {
    user.avatar = avatar;
  }

  // Check if detail fields are submitted
  const isSettingDetails =
    phone !== undefined ||
    nid !== undefined ||
    permanentAddress !== undefined ||
    dob !== undefined ||
    bloodGroup !== undefined ||
    emergencyContact !== undefined;

  if (isSettingDetails) {
    if (!isAdmin && user.isDetailsSet) {
      // Non-admin trying to edit locked details
      const isPhoneChanged = phone !== undefined && phone.trim() !== (user.phone || "");
      const isNidChanged = nid !== undefined && nid.trim() !== (user.nid || "");
      const isAddressChanged = permanentAddress !== undefined && permanentAddress.trim() !== (user.permanentAddress || "");
      const isDobChanged = dob !== undefined && dob !== (user.dob ? new Date(user.dob).toISOString().split("T")[0] : "");
      const isBloodChanged = bloodGroup !== undefined && bloodGroup !== (user.bloodGroup || "");
      const isEmergencyChanged = emergencyContact !== undefined && emergencyContact.trim() !== (user.emergencyContact || "");

      if (isPhoneChanged || isNidChanged || isAddressChanged || isDobChanged || isBloodChanged || isEmergencyChanged) {
        return res.status(403).json({
          success: false,
          message: "Your personal identification details (NID, Address, Phone, DOB, Blood Group, Emergency Contact) have been submitted and locked. Only an Admin can edit or delete these details.",
        });
      }
    } else {
      // Allowed to set (Admin or First-time Non-admin)
      if (phone !== undefined) user.phone = phone ? phone.trim() : "";
      if (nid !== undefined) user.nid = nid ? nid.trim() : "";
      if (permanentAddress !== undefined) user.permanentAddress = permanentAddress ? permanentAddress.trim() : "";
      if (dob !== undefined) user.dob = dob ? new Date(dob) : null;
      if (bloodGroup !== undefined) user.bloodGroup = bloodGroup || "";
      if (emergencyContact !== undefined) user.emergencyContact = emergencyContact ? emergencyContact.trim() : "";

      // If user has provided any detail, lock it
      if (user.phone || user.nid || user.permanentAddress || user.dob || user.bloodGroup || user.emergencyContact) {
        if (!user.isDetailsSet) {
          user.isDetailsSet = true;
          user.detailsSetAt = new Date();
        }
      }
    }
  }

  await user.save();
  const populatedUser = await User.findById(user._id).populate("verifiedBy", "name email role");

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: { user: populatedUser },
  });
});

// @desc    Change password
// @route   PUT /api/user/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.user.id).select("+password");

  // Check current password
  const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordCorrect) {
    return res.status(400).json({
      success: false,
      message: "Current password is incorrect",
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
});

// @desc    Delete user account
// @route   DELETE /api/user/account
// @access  Private
const deleteAccount = asyncHandler(async (req, res) => {
  await User.findByIdAndDelete(req.user.id);

  res.status(200).json({
    success: true,
    message: "Account deleted successfully",
  });
});

// @desc    Get all users (Admin only)
// @route   GET /api/user/all
// @access  Private/Admin
const getAllUsers = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const paginationStr = req.query.pagination;

  const [adminCount, managerCount, employeeCount, salesmanCount] = await Promise.all([
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ role: "manager" }),
    User.countDocuments({ role: "employee" }),
    User.countDocuments({ role: "salesman" }),
  ]);

  if (paginationStr === "false") {
    const users = await User.find()
      .select("-refreshToken")
      .populate("verifiedBy", "name email role")
      .sort({ updatedAt: -1, createdAt: -1 });
    const total = users.length;

    const stats = {
      total,
      adminCount,
      managerCount,
      employeeCount,
      salesmanCount,
      staffCount: employeeCount + salesmanCount + managerCount,
    };

    return res.status(200).json({
      success: true,
      stats,
      data: {
        users,
        stats,
        pagination: {
          page: 1,
          limit: total,
          total,
          pages: 1,
        },
      },
    });
  }

  const skip = (page - 1) * limit;

  const users = await User.find()
    .select("-refreshToken")
    .populate("verifiedBy", "name email role")
    .skip(skip)
    .limit(limit)
    .sort({ updatedAt: -1, createdAt: -1 });

  const total = await User.countDocuments();

  const stats = {
    total,
    adminCount,
    managerCount,
    employeeCount,
    salesmanCount,
    staffCount: employeeCount + salesmanCount + managerCount,
  };

  res.status(200).json({
    success: true,
    stats,
    data: {
      users,
      stats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get user by ID (Admin only)
// @route   GET /api/user/:id
// @access  Private/Admin
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate("verifiedBy", "name email role");

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    data: { user },
  });
});

// @desc    Update user role (Admin only)
// @route   PUT /api/user/:id/role
// @access  Private/Admin
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "User role updated successfully",
    data: { user },
  });
});

// @desc    Delete user (Admin only)
// @route   DELETE /api/user/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account from here.",
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // 1. First delete image from Cloudinary if exists
  if (user.avatar && user.avatar.includes("cloudinary.com")) {
    try {
      const publicId = extractPublicIdFromUrl(user.avatar);
      if (publicId) {
        await deleteImageFromCloudinary(publicId);
        console.log(`Successfully deleted Cloudinary avatar for user ${user._id}`);
      }
    } catch (imgError) {
      console.error("Cloudinary avatar deletion error:", imgError);
    }
  }

  // 2. Then delete user from database
  await User.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
  });
});

// @desc    Create a new system user (Admin only)
// @route   POST /api/user
// @access  Private/Admin
const createUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    phone,
    nid,
    permanentAddress,
    dob,
    bloodGroup,
    emergencyContact,
    employeeId,
    isProfileVerified,
  } = req.body;

  if (!name || !email || !password) {
    if (req.file && req.file.filename) {
      await deleteImageFromCloudinary(req.file.filename).catch(() => {});
    }
    return res.status(400).json({
      success: false,
      message: "Please provide name, email, and password",
    });
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    if (req.file && req.file.filename) {
      await deleteImageFromCloudinary(req.file.filename).catch(() => {});
    }
    return res.status(400).json({
      success: false,
      message: "User with this email already exists",
    });
  }

  let avatar = req.body.avatar || null;
  if (req.file) {
    avatar = req.file.path; // Cloudinary URL
  }

  const hasDetails = Boolean(phone || nid || permanentAddress || dob || bloodGroup || emergencyContact || employeeId);
  const willVerify = Boolean(isProfileVerified === true || isProfileVerified === "true");

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password,
    role: role || "user",
    avatar,
    phone: phone ? phone.trim() : "",
    nid: nid ? nid.trim() : "",
    permanentAddress: permanentAddress ? permanentAddress.trim() : "",
    dob: dob ? new Date(dob) : null,
    bloodGroup: bloodGroup || "",
    emergencyContact: emergencyContact ? emergencyContact.trim() : "",
    employeeId: employeeId ? employeeId.trim() : "",
    isDetailsSet: hasDetails,
    detailsSetAt: hasDetails ? new Date() : null,
    isProfileVerified: willVerify,
    verifiedBy: willVerify ? req.user.id : null,
    verifiedAt: willVerify ? new Date() : null,
  });

  const populatedUser = await User.findById(user._id).populate("verifiedBy", "name email role");

  res.status(201).json({
    success: true,
    message: "User created successfully",
    data: {
      user: populatedUser,
    },
  });
});

// @desc    Update any user details by Admin (name, email, role, avatar, identification details)
// @route   PUT /api/admin/user/:id
// @access  Private/Admin
const updateUserByAdmin = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    role,
    avatar,
    phone,
    nid,
    permanentAddress,
    dob,
    bloodGroup,
    emergencyContact,
    employeeId,
    isProfileVerified,
    isDetailsSet,
  } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    if (req.file && req.file.filename) {
      await deleteImageFromCloudinary(req.file.filename).catch(() => {});
    }
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Check email uniqueness if email is changed
  if (email && email.toLowerCase() !== user.email.toLowerCase()) {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (req.file && req.file.filename) {
        await deleteImageFromCloudinary(req.file.filename).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }
    user.email = email.toLowerCase();
  }

  if (name) user.name = name.trim();
  // Admin role cannot be changed from User Management page
  if (user.role === "admin") {
    user.role = "admin";
  } else if (role && role !== "admin") {
    user.role = role;
  }

  // Handle identification details
  if (phone !== undefined) user.phone = phone ? phone.trim() : "";
  if (nid !== undefined) user.nid = nid ? nid.trim() : "";
  if (permanentAddress !== undefined) user.permanentAddress = permanentAddress ? permanentAddress.trim() : "";
  if (dob !== undefined) user.dob = dob ? new Date(dob) : null;
  if (bloodGroup !== undefined) user.bloodGroup = bloodGroup || "";
  if (emergencyContact !== undefined) user.emergencyContact = emergencyContact ? emergencyContact.trim() : "";
  if (employeeId !== undefined) user.employeeId = employeeId ? employeeId.trim() : "";

  // Handle Details Set / Lock state
  if (isDetailsSet !== undefined) {
    user.isDetailsSet = Boolean(isDetailsSet === true || isDetailsSet === "true");
    if (user.isDetailsSet && !user.detailsSetAt) {
      user.detailsSetAt = new Date();
    }
  } else if (user.phone || user.nid || user.permanentAddress || user.dob || user.bloodGroup || user.emergencyContact) {
    user.isDetailsSet = true;
    if (!user.detailsSetAt) user.detailsSetAt = new Date();
  }

  // Handle Verification state
  if (isProfileVerified !== undefined) {
    const willVerify = Boolean(isProfileVerified === true || isProfileVerified === "true");
    if (willVerify && !user.isProfileVerified) {
      user.isProfileVerified = true;
      user.verifiedBy = req.user.id;
      user.verifiedAt = new Date();
    } else if (!willVerify && user.isProfileVerified) {
      user.isProfileVerified = false;
      user.verifiedBy = null;
      user.verifiedAt = null;
    }
  }

  // Handle image update (file upload via multer or avatar parameter)
  if (req.file) {
    // Delete previous image from Cloudinary FIRST if exists
    if (user.avatar && user.avatar.includes("cloudinary.com")) {
      try {
        const oldPublicId = extractPublicIdFromUrl(user.avatar);
        if (oldPublicId) {
          await deleteImageFromCloudinary(oldPublicId);
          console.log(`Deleted previous Cloudinary avatar for user ${user._id}`);
        }
      } catch (imgError) {
        console.error("Failed to delete previous avatar from Cloudinary:", imgError);
      }
    }
    user.avatar = req.file.path; // New Cloudinary image URL
  } else if (avatar !== undefined) {
    if (avatar !== user.avatar && user.avatar && user.avatar.includes("cloudinary.com")) {
      try {
        const oldPublicId = extractPublicIdFromUrl(user.avatar);
        if (oldPublicId) {
          await deleteImageFromCloudinary(oldPublicId);
        }
      } catch (imgError) {
        console.error("Failed to delete previous avatar from Cloudinary:", imgError);
      }
    }
    user.avatar = avatar;
  }

  await user.save();
  const populatedUser = await User.findById(user._id).populate("verifiedBy", "name email role");

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    data: {
      user: populatedUser,
    },
  });
});

// @desc    Verify / Unverify user details (Admin only)
// @route   PUT /api/admin/user/:id/verify
// @access  Private/Admin
const verifyUserDetails = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.role === "admin") {
    return res.status(400).json({
      success: false,
      message: "Admin accounts do not require verification",
    });
  }

  const { isProfileVerified, employeeId } = req.body;
  const newStatus = isProfileVerified !== undefined ? Boolean(isProfileVerified === true || isProfileVerified === "true") : !user.isProfileVerified;

  if (newStatus) {
    if (employeeId && employeeId.trim()) {
      user.employeeId = employeeId.trim();
    } else if (!user.employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required to verify the user profile",
      });
    }
    user.isProfileVerified = true;
    user.verifiedBy = req.user.id;
    user.verifiedAt = new Date();
  } else {
    user.isProfileVerified = false;
    user.verifiedBy = null;
    user.verifiedAt = null;
  }

  await user.save();
  const populatedUser = await User.findById(user._id).populate("verifiedBy", "name email role");

  try {
    logActivity({
      req,
      action: newStatus ? "VERIFY_USER_DETAILS" : "UNVERIFY_USER_DETAILS",
      entityType: "User",
      entityId: user._id,
      description: `${newStatus ? "Verified" : "Unverified"} identification details for ${user.name} (${user.email})`,
      metadata: { userId: user._id, isProfileVerified: newStatus },
    });
  } catch (err) {
    console.error("Failed to log activity:", err);
  }

  res.status(200).json({
    success: true,
    message: `User details ${newStatus ? "verified" : "unverified"} successfully`,
    data: { user: populatedUser },
  });
});

// @desc    Upload profile image
// @route   POST /api/user/upload-profile-image
// @access  Private
const uploadProfileImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No image file provided",
    });
  }

  try {
    // Get user's current profile image for cleanup
    const user = await User.findById(req.user.id);
    const currentAvatar = user.avatar;

    // Update user with new profile image URL
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      {
        avatar: req.file.path, // Cloudinary URL
      },
      {
        new: true,
        runValidators: true,
      },
    );

    // Delete old profile image from Cloudinary if exists
    if (currentAvatar && currentAvatar.includes("cloudinary.com")) {
      try {
        const publicId = extractPublicIdFromUrl(currentAvatar);
        if (publicId) {
          await deleteImageFromCloudinary(publicId);
        }
      } catch (error) {
        console.error("Error deleting old profile image:", error);
        // Don't fail the request if old image deletion fails
      }
    }

    res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      data: {
        user: updatedUser,
        imageUrl: req.file.path,
        publicId: req.file.filename,
      },
    });
  } catch (error) {
    // If user update fails, delete the uploaded image
    if (req.file && req.file.filename) {
      try {
        await deleteImageFromCloudinary(req.file.filename);
      } catch (deleteError) {
        console.error(
          "Error deleting uploaded image after failure:",
          deleteError,
        );
      }
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update profile image",
      error: error.message,
    });
  }
});

// @desc    Delete profile image
// @route   DELETE /api/user/profile-image
// @access  Private
const deleteProfileImage = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user.avatar) {
    return res.status(400).json({
      success: false,
      message: "No profile image to delete",
    });
  }

  // Delete image from Cloudinary if it's a Cloudinary URL
  if (user.avatar.includes("cloudinary.com")) {
    try {
      const publicId = extractPublicIdFromUrl(user.avatar);
      if (publicId) {
        await deleteImageFromCloudinary(publicId);
      }
    } catch (error) {
      console.error("Error deleting image from Cloudinary:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete image from cloud storage",
      });
    }
  }

  // Remove avatar from user document
  const updatedUser = await User.findByIdAndUpdate(
    req.user.id,
    {
      $unset: { avatar: 1 },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  res.status(200).json({
    success: true,
    message: "Profile image deleted successfully",
    data: { user: updatedUser },
  });
});

// @desc    Redeem & Reset salesman reward points by Admin (cash payout, gift, bonus)
// @route   POST /api/admin/user/:id/reset-points
// @access  Private/Admin
const resetSalesmanRewardPoints = asyncHandler(async (req, res) => {
  const { rewardType, note, amountPaid, pointsToReset } = req.body;

  // 1. Validate pointsToReset is required and > 0
  const pts = parseInt(pointsToReset, 10);
  if (!pointsToReset || isNaN(pts) || pts <= 0) {
    return res.status(400).json({
      success: false,
      message: "pointsToReset is required and must be a positive number greater than 0.",
    });
  }

  // 2. Validate rewardType is required
  const validTypes = ["cash", "gift", "commission", "manual"];
  if (!rewardType || !validTypes.includes(rewardType)) {
    return res.status(400).json({
      success: false,
      message: "rewardType is required and must be one of: cash, gift, commission, manual.",
    });
  }

  // 3. Validate amountPaid is required
  const amt = parseFloat(amountPaid);
  if (amountPaid === undefined || amountPaid === null || amountPaid === "" || isNaN(amt) || amt < 0) {
    return res.status(400).json({
      success: false,
      message: "amountPaid (Cash Amount or Gift Value) is required and must be a valid number.",
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const currentPoints = user.rewardPoints || 0;
  if (currentPoints <= 0) {
    return res.status(400).json({
      success: false,
      message: "This salesman has no reward points available to redeem.",
    });
  }

  if (pts > currentPoints) {
    return res.status(400).json({
      success: false,
      message: `Cannot redeem ${pts} points. Salesman currently has only ${currentPoints} points available.`,
    });
  }

  const pointsDeducted = pts;

  // Push redemption record to history
  if (!Array.isArray(user.redemptionHistory)) {
    user.redemptionHistory = [];
  }
  user.redemptionHistory.push({
    pointsRedeemed: pointsDeducted,
    rewardType: rewardType || "cash",
    amountPaid: amountPaid ? parseFloat(amountPaid) : 0,
    note: note || "",
    redeemedAt: new Date(),
  });

  // Deduct points
  user.rewardPoints = Math.max(0, currentPoints - pointsDeducted);
  await user.save();

  // Log activity
  try {
    logActivity({
      req,
      action: "REDEEM_SALESMAN_POINTS",
      entityType: "User",
      entityId: user._id,
      description: `Redeemed ${pointsDeducted} reward points for ${user.name} via ${rewardType || 'cash/gift'}. Note: ${note || 'None'}`,
      metadata: {
        userId: user._id,
        salesmanName: user.name,
        previousPoints: currentPoints,
        pointsDeducted,
        remainingPoints: user.rewardPoints,
        rewardType: rewardType || "cash",
        amountPaid: amountPaid || 0,
        note: note || "",
      },
    });
  } catch (logErr) {
    console.error("Failed to log activity:", logErr);
  }

  res.status(200).json({
    success: true,
    message: `Successfully redeemed ${pointsDeducted} reward points for ${user.name}`,
    data: {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        rewardPoints: user.rewardPoints,
      },
      redemptionSummary: {
        previousPoints: currentPoints,
        pointsDeducted,
        remainingPoints: user.rewardPoints,
        rewardType: rewardType || "cash",
        amountPaid: amountPaid || 0,
        note: note || "",
      },
    },
  });
});

module.exports = {
  updateProfile,
  changePassword,
  deleteAccount,
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  createUser,
  updateUserByAdmin,
  uploadProfileImage,
  deleteProfileImage,
  resetSalesmanRewardPoints,
  verifyUserDetails,
};
