/**
 * ============================================================
 * models/Attendance.js — Employee Attendance Record
 * ============================================================
 * Stores daily attendance check-in, check-out, working minutes,
 * geofence validation results, device IDs, and administrative audit trails.
 * ============================================================
 */
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee reference is required"],
      index: true,
    },
    // Historical display snapshots (not used for auth)
    employeeName: {
      type: String,
      trim: true,
      default: "",
    },
    employeeEmail: {
      type: String,
      trim: true,
      default: "",
    },
    employeeRole: {
      type: String,
      trim: true,
      default: "",
    },
    employeeId: {
      type: String,
      trim: true,
      default: "",
    },
    // Date in Asia/Dhaka timezone (e.g., "2026-09-09")
    attendanceDate: {
      type: String,
      required: [true, "Attendance date is required"],
      index: true,
    },
    checkInAt: {
      type: Date,
      default: null,
    },
    checkOutAt: {
      type: Date,
      default: null,
    },
    // Working duration stored strictly in minutes (formatted at display time)
    workingMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "working",
        "present",
        "late",
        "checked_out",
        "incomplete",
        "manual_correction",
      ],
      default: "working",
    },
    late: {
      type: Boolean,
      default: false,
    },
    lateMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    checkInLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      distanceFromOffice: { type: Number, default: null },
    },
    checkOutLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      distanceFromOffice: { type: Number, default: null },
    },
    checkInDeviceId: {
      type: String,
      default: "",
    },
    checkOutDeviceId: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    // Administrative correction audit history
    correctionAudit: [
      {
        modifiedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        modifiedByName: {
          type: String,
          default: "",
        },
        modifiedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          required: [true, "Correction reason is required"],
        },
        previousValue: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },
        newValue: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound unique index ensuring only 1 record per employee per calendar date
attendanceSchema.index({ employee: 1, attendanceDate: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
