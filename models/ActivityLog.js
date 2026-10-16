const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
    },
    userRole: {
      type: String,
      required: true,
      enum: ["admin", "employee", "salesman", "manager", "user"],
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    entityType: {
      type: String,
      required: true,
      enum: [
        "Product",
        "Order",
        "Sale",
        "Category",
        "SubCategory",
        "Brand",
        "Coupon",
        "OfferDeal",
        "Customer",
        "Return",
        "User",
        "Vendor",
        "VendorReturn",
        "Purchase",
        "Expense",
        "Exchange",
        "Settings",
        "Attendance",
        "AttendanceSettings",
        "AttendanceDevice",
        "ShopDocument",
        "System"
      ],
      default: "System",
    },
    entityId: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    oldValues: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValues: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Add indexes for fast searching and filtering
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userRole: 1, createdAt: -1 });
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ entityType: 1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
