/**
 * ============================================================
 * models/User.js — Admin/Employee/Salesman User Model
 * ============================================================
 * এই model Admin dashboard এ যে সব user login করে তাদের data সাভ করে।
 *
 * User roles এর অর্থ:
 *  - admin     → সব কিছু করতে পারেN (delete, create, manage)
 *  - employee  → প্রডাক্ট, অর্ডার manage করতে পারেন, delete পারেন না
 *  - salesman  → শুধু POS/counter সেলস করতে পারেন
 *  - user      → default role (সাধারণত ব্যবহার হয় না)
 *
 * গুরুত্বপূর্ণ বিষয়:
 *  - password সরাসরি database এ save হয় না, bcrypt দিয়ে hash হয়
 *  - select: false থাকায় password ব্যবহারের বাইরে চলে যায় না
 *  - refreshToken database এ সাভ করা হয় (logout তে invalidate হয়)
 *  - comparePassword() দিয়ে login ঎ password যাচাই হয়
 *  - updateLastLogin() দিয়ে শেষ login সময় update হয়
 * ============================================================
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Don't include password in queries by default
    },
    role: {
      type: String,
      enum: ["user", "employee", "admin", "salesman", "manager"], // "manager" & "salesman" supported
      default: "user",
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    avatar: {
      type: String,
      default: null,
    },
    rewardPoints: {
      type: Number,
      default: 0,
      min: [0, "Reward points cannot be negative"],
    },
    redemptionHistory: [
      {
        pointsRedeemed: { type: Number, required: true },
        rewardType: { type: String, default: "cash" },
        amountPaid: { type: Number, default: 0 },
        note: { type: String, default: "" },
        redeemedAt: { type: Date, default: Date.now },
      },
    ],
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    nid: {
      type: String,
      default: "",
      trim: true,
    },
    permanentAddress: {
      type: String,
      default: "",
      trim: true,
    },
    dob: {
      type: Date,
      default: null,
    },
    bloodGroup: {
      type: String,
      default: "",
      enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", ""],
    },
    emergencyContact: {
      type: String,
      default: "",
      trim: true,
    },
    isDetailsSet: {
      type: Boolean,
      default: false,
    },
    detailsSetAt: {
      type: Date,
      default: null,
    },
    isProfileVerified: {
      type: Boolean,
      default: false,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    employeeId: {
      type: String,
      default: "",
      trim: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    loginCount: {
      type: Number,
      default: 0,
    },
    loginHistory: [
      {
        ipAddress: { type: String, default: "Unknown" },
        device: { type: String, default: "Unknown" },
        loginTime: { type: Date, default: Date.now },
        logoutTime: { type: Date, default: null },
        workingHours: { type: Number, default: 0 }, // Duration in milliseconds
      }
    ],
    refreshToken: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Remove the manual index creation to avoid duplicate index warning
// The unique: true in the schema automatically creates the index

// Hash password before saving
userSchema.pre("save", async function (next) {
  // Only hash password if it's modified
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Convert to JSON (remove sensitive data)
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.refreshToken;
  delete userObject.__v;
  return userObject;
};

// Simple helper function to parse user agent
function parseUserAgent(ua) {
  if (!ua) return "Unknown Device";
  let os = "Unknown OS";
  let browser = "Unknown Browser";
  
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Macintosh") || ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Linux")) os = "Linux";
  
  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("MSIE") || ua.includes("Trident")) browser = "IE";
  
  return `${browser} on ${os}`;
}

// Update last login
userSchema.methods.updateLastLogin = function (ip, userAgent) {
  this.lastLogin = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
  
  let cleanIp = ip || "Unknown IP";
  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.replace("::ffff:", "");
  }
  if (cleanIp === "::1") {
    cleanIp = "127.0.0.1";
  }
  
  const device = userAgent ? parseUserAgent(userAgent) : "Unknown Device";
  this.loginHistory.push({
    ipAddress: cleanIp,
    device: device,
    loginTime: new Date()
  });
  
  return this.save();
};

module.exports = mongoose.model("User", userSchema);
