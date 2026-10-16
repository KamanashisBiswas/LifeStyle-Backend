/**
 * ============================================================
 * models/AttendanceSettings.js — Employee Attendance Settings
 * ============================================================
 * Configuration for office coordinates, allowed geofence radius,
 * work times, late thresholds, and maximum GPS accuracy.
 * Coordinates default to null and attendanceEnabled defaults to false.
 * ============================================================
 */
const mongoose = require("mongoose");

const attendanceSettingsSchema = new mongoose.Schema(
  {
    officeName: {
      type: String,
      default: "LifeStyle Main Office",
      trim: true,
    },
    latitude: {
      type: Number,
      default: null, // Unset initially
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      default: null, // Unset initially
      min: -180,
      max: 180,
    },
    allowedRadius: {
      type: Number,
      default: 100, // in meters
      min: 10,
    },
    attendanceEnabled: {
      type: Boolean,
      default: false, // Must be explicitly enabled by Admin
    },
    workStartTime: {
      type: String,
      default: "09:00", // HH:mm format
      trim: true,
    },
    workEndTime: {
      type: String,
      default: "18:00", // HH:mm format
      trim: true,
    },
    lateThresholdMinutes: {
      type: Number,
      default: 15, // 15 mins grace period
      min: 0,
    },
    maxGpsAccuracy: {
      type: Number,
      default: 300, // maximum acceptable GPS accuracy in meters (supports desktop Wi-Fi & mobile)
      min: 5,
    },
    timezone: {
      type: String,
      default: "Asia/Dhaka",
    },
  },
  {
    timestamps: true,
  }
);

// Helper method to retrieve or initialize the single settings document
attendanceSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model("AttendanceSettings", attendanceSettingsSchema);
