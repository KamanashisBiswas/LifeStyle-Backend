/**
 * ============================================================
 * models/AttendanceDevice.js — Registered Employee Attendance Device
 * ============================================================
 * Stores the single active registered device/browser identifier for an employee.
 * Provides an additional verification layer.
 * ============================================================
 */
const mongoose = require("mongoose");

const attendanceDeviceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee reference is required"],
      unique: true, // One registered device per employee
    },
    deviceId: {
      type: String,
      required: [true, "Device ID is required"],
      trim: true,
    },
    deviceName: {
      type: String,
      default: "Web Browser Device",
      trim: true,
    },
    userAgent: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["registered", "blocked"],
      default: "registered",
    },
    registeredAt: {
      type: Date,
      default: Date.now,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("AttendanceDevice", attendanceDeviceSchema);
