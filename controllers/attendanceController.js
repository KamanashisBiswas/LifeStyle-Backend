/**
 * ============================================================
 * controllers/attendanceController.js — Employee Attendance Controller
 * ============================================================
 * Manages employee check-in, check-out, geofencing validations,
 * device registrations, admin analytics, and manual corrections.
 * ============================================================
 */

const Attendance = require("../models/Attendance");
const AttendanceSettings = require("../models/AttendanceSettings");
const AttendanceDevice = require("../models/AttendanceDevice");
const User = require("../models/User");
const Leave = require("../models/Leave");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLogger");
const {
  calculateHaversineDistance,
  getDhakaDateString,
  timeStringToMinutes,
  calculateWorkingMinutes,
} = require("../utils/geofence");

// ============================================================
// EMPLOYEE APIS
// ============================================================

/**
 * @desc    Get current employee's attendance status for today
 * @route   GET /api/attendance/today
 * @access  Private (All staff)
 */
const getMyTodayAttendance = asyncHandler(async (req, res) => {
  const settings = await AttendanceSettings.getSettings();
  const todayDate = getDhakaDateString();

  const attendance = await Attendance.findOne({
    employee: req.user._id || req.user.id,
    attendanceDate: todayDate,
  }).lean();

  const device = await AttendanceDevice.findOne({
    employee: req.user._id || req.user.id,
  }).lean();

  const isOfficeConfigured =
    settings.latitude !== null &&
    settings.longitude !== null &&
    !isNaN(settings.latitude) &&
    !isNaN(settings.longitude);

  res.status(200).json({
    success: true,
    data: {
      attendanceDate: todayDate,
      attendance: attendance || null,
      device: device
        ? {
            isRegistered: true,
            status: device.status,
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            lastUsedAt: device.lastUsedAt,
          }
        : {
            isRegistered: false,
          },
      settings: {
        attendanceEnabled: Boolean(settings.attendanceEnabled),
        isOfficeConfigured,
        officeName: settings.officeName,
        latitude: settings.latitude,
        longitude: settings.longitude,
        allowedRadius: settings.allowedRadius,
        maxGpsAccuracy: settings.maxGpsAccuracy,
        workStartTime: settings.workStartTime,
        workEndTime: settings.workEndTime,
        lateThresholdMinutes: settings.lateThresholdMinutes,
      },
    },
  });
});

/**
 * @desc    Register employee's current device (Requires being inside office geofence)
 * @route   POST /api/attendance/device/register
 * @access  Private (All staff)
 */
const registerMyDevice = asyncHandler(async (req, res) => {
  const { deviceId, deviceName, latitude, longitude, accuracy } = req.body;

  if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
    return res.status(400).json({
      success: false,
      message: "Valid Device Identifier is required.",
    });
  }

  const settings = await AttendanceSettings.getSettings();

  if (
    !settings.attendanceEnabled ||
    settings.latitude === null ||
    settings.longitude === null
  ) {
    return res.status(400).json({
      success: false,
      message: "Attendance location has not been configured yet. Please contact Admin.",
    });
  }

  // Validate GPS coordinates
  const lat = Number(latitude);
  const lon = Number(longitude);
  const acc = Number(accuracy);

  if (
    isNaN(lat) ||
    isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid GPS coordinates are required for device registration.",
    });
  }

  if (isNaN(acc) || acc <= 0) {
    return res.status(400).json({
      success: false,
      message: "GPS accuracy could not be determined. Please enable location services and retry.",
    });
  }

  if (acc > settings.maxGpsAccuracy) {
    return res.status(400).json({
      success: false,
      message: `Your GPS accuracy is too low (±${Math.round(acc)}m). Maximum acceptable accuracy is ±${settings.maxGpsAccuracy}m. Please move to an open area and try again.`,
    });
  }

  // Calculate Haversine distance
  const distance = calculateHaversineDistance(
    lat,
    lon,
    settings.latitude,
    settings.longitude
  );

  if (distance > settings.allowedRadius) {
    return res.status(400).json({
      success: false,
      message: `Device registration is only available inside the office attendance area. (Your distance: ${distance}m, Allowed: ${settings.allowedRadius}m)`,
      distance,
      allowedRadius: settings.allowedRadius,
    });
  }

  const userAgent = req.headers["user-agent"] || "";

  const device = await AttendanceDevice.findOneAndUpdate(
    { employee: req.user._id || req.user.id },
    {
      deviceId: deviceId.trim(),
      deviceName: (deviceName || "Web Browser Device").trim(),
      userAgent,
      status: "registered",
      lastUsedAt: new Date(),
      registeredAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logActivity({
    req,
    action: "REGISTER_ATTENDANCE_DEVICE",
    entityType: "AttendanceDevice",
    entityId: device._id,
    description: `Staff '${req.user.name}' registered attendance device '${device.deviceName}' (Distance: ${distance}m)`,
    metadata: { distance, deviceId: device.deviceId }
  });

  res.status(200).json({
    success: true,
    message: "Device registered successfully! You can now check in.",
    data: device,
  });
});

/**
 * @desc    Employee Check In
 * @route   POST /api/attendance/check-in
 * @access  Private (All staff)
 */
const checkIn = asyncHandler(async (req, res) => {
  const { latitude, longitude, accuracy, deviceId, notes } = req.body;

  const settings = await AttendanceSettings.getSettings();

  // 1. Check if Attendance is enabled & configured
  if (
    !settings.attendanceEnabled ||
    settings.latitude === null ||
    settings.longitude === null
  ) {
    return res.status(400).json({
      success: false,
      message: "Attendance location has not been configured yet. Please contact Admin.",
    });
  }

  // 2. Validate GPS coordinates
  const lat = Number(latitude);
  const lon = Number(longitude);
  const acc = Number(accuracy);

  if (
    isNaN(lat) ||
    isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid GPS coordinates are required to mark attendance.",
    });
  }

  if (isNaN(acc) || acc <= 0) {
    return res.status(400).json({
      success: false,
      message: "Your location could not be determined accurately. Please allow browser location access and try again.",
    });
  }

  if (acc > settings.maxGpsAccuracy) {
    return res.status(400).json({
      success: false,
      message: `Your GPS accuracy (±${Math.round(acc)}m) is too poor. Required accuracy is within ±${settings.maxGpsAccuracy}m. Please move to an open area and retry.`,
    });
  }

  // 3. Server-side Geofence calculation
  const distanceFromOffice = calculateHaversineDistance(
    lat,
    lon,
    settings.latitude,
    settings.longitude
  );

  if (distanceFromOffice > settings.allowedRadius) {
    return res.status(400).json({
      success: false,
      message: `You are outside the attendance area. (Your distance: ${distanceFromOffice}m, Allowed: ${settings.allowedRadius}m)`,
      distanceFromOffice,
      allowedRadius: settings.allowedRadius,
    });
  }

  // 4. Device verification
  const registeredDevice = await AttendanceDevice.findOne({
    employee: req.user._id || req.user.id,
    status: "registered",
  });

  if (!registeredDevice) {
    return res.status(400).json({
      success: false,
      errorCode: "NO_DEVICE_REGISTERED",
      message: "No attendance device is registered for your account. Please register this device first inside the office.",
    });
  }

  if (
    !deviceId ||
    deviceId.trim() !== registeredDevice.deviceId
  ) {
    return res.status(400).json({
      success: false,
      errorCode: "UNREGISTERED_DEVICE",
      message: "This device is not registered for your attendance. Please contact Admin or register this device.",
    });
  }

  // 5. Duplicate Check for Today (Asia/Dhaka)
  const todayDate = getDhakaDateString();
  const existingAttendance = await Attendance.findOne({
    employee: req.user._id || req.user.id,
    attendanceDate: todayDate,
  });

  if (existingAttendance) {
    return res.status(400).json({
      success: false,
      message: "You have already checked in today.",
    });
  }

  // 6. Calculate Late Status using Server Time (Asia/Dhaka)
  const now = new Date();
  const nowMinutes = timeStringToMinutes(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now)
  );

  const startMinutes = timeStringToMinutes(settings.workStartTime);
  const thresholdMinutes = Number(settings.lateThresholdMinutes || 0);

  let isLate = false;
  let lateMinutes = 0;

  if (nowMinutes > startMinutes + thresholdMinutes) {
    isLate = true;
    lateMinutes = nowMinutes - startMinutes;
  }

  // 7. Create Attendance Record
  try {
    const attendance = await Attendance.create({
      employee: req.user._id || req.user.id,
      employeeName: req.user.name || "",
      employeeEmail: req.user.email || "",
      employeeRole: req.user.role || "",
      employeeId: req.user.employeeId || "",
      attendanceDate: todayDate,
      checkInAt: now,
      status: isLate ? "late" : "working",
      late: isLate,
      lateMinutes,
      checkInLocation: {
        latitude: lat,
        longitude: lon,
        accuracy: acc,
        distanceFromOffice,
      },
      checkInDeviceId: deviceId.trim(),
      notes: notes ? notes.trim() : "",
    });

    // Update device last used
    registeredDevice.lastUsedAt = now;
    await registeredDevice.save();

    logActivity({
      req,
      action: "ATTENDANCE_CHECK_IN",
      entityType: "Attendance",
      entityId: attendance._id,
      description: `Staff '${req.user.name}' checked in at ${now.toLocaleTimeString()} (${isLate ? `Late by ${lateMinutes}m` : "On Time"}, Distance: ${distanceFromOffice}m)`,
      metadata: { distance: distanceFromOffice, late: isLate, lateMinutes }
    });

    res.status(201).json({
      success: true,
      message: isLate
        ? `Checked in successfully (Late by ${lateMinutes} minutes).`
        : "Checked in successfully! Have a great workday.",
      data: attendance,
    });
  } catch (err) {
    // Handle duplicate key error (race condition)
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You have already checked in today.",
      });
    }
    throw err;
  }
});

/**
 * @desc    Employee Check Out
 * @route   POST /api/attendance/check-out
 * @access  Private (All staff)
 */
const checkOut = asyncHandler(async (req, res) => {
  const { latitude, longitude, accuracy, deviceId, notes } = req.body;

  const settings = await AttendanceSettings.getSettings();

  if (
    !settings.attendanceEnabled ||
    settings.latitude === null ||
    settings.longitude === null
  ) {
    return res.status(400).json({
      success: false,
      message: "Attendance location has not been configured yet. Please contact Admin.",
    });
  }

  // 1. Validate GPS
  const lat = Number(latitude);
  const lon = Number(longitude);
  const acc = Number(accuracy);

  if (
    isNaN(lat) ||
    isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid GPS coordinates are required to check out.",
    });
  }

  if (isNaN(acc) || acc <= 0) {
    return res.status(400).json({
      success: false,
      message: "Your location could not be determined accurately. Please allow location access and retry.",
    });
  }

  if (acc > settings.maxGpsAccuracy) {
    return res.status(400).json({
      success: false,
      message: `Your GPS accuracy (±${Math.round(acc)}m) is too poor. Maximum allowed is ±${settings.maxGpsAccuracy}m.`,
    });
  }

  // 2. Geofence calculation
  const distanceFromOffice = calculateHaversineDistance(
    lat,
    lon,
    settings.latitude,
    settings.longitude
  );

  if (distanceFromOffice > settings.allowedRadius) {
    return res.status(400).json({
      success: false,
      message: `Check-out rejected. You are outside the attendance area. (Your distance: ${distanceFromOffice}m, Allowed: ${settings.allowedRadius}m)`,
      distanceFromOffice,
      allowedRadius: settings.allowedRadius,
    });
  }

  // 3. Device verification
  const registeredDevice = await AttendanceDevice.findOne({
    employee: req.user._id || req.user.id,
    status: "registered",
  });

  if (!registeredDevice || registeredDevice.deviceId !== (deviceId || "").trim()) {
    return res.status(400).json({
      success: false,
      message: "This device is not registered for your attendance. Please contact Admin.",
    });
  }

  // 4. Find today's record
  const todayDate = getDhakaDateString();
  const attendance = await Attendance.findOne({
    employee: req.user._id || req.user.id,
    attendanceDate: todayDate,
  });

  if (!attendance) {
    return res.status(400).json({
      success: false,
      message: "You have not checked in today.",
    });
  }

  if (attendance.checkOutAt) {
    return res.status(400).json({
      success: false,
      message: "You have already checked out today.",
    });
  }

  const now = new Date();
  const workingMinutes = calculateWorkingMinutes(attendance.checkInAt, now);

  attendance.checkOutAt = now;
  attendance.workingMinutes = workingMinutes;
  attendance.status = attendance.late ? "late" : "present";
  attendance.checkOutLocation = {
    latitude: lat,
    longitude: lon,
    accuracy: acc,
    distanceFromOffice,
  };
  attendance.checkOutDeviceId = (deviceId || "").trim();
  if (notes) attendance.notes = (attendance.notes ? attendance.notes + " | " : "") + notes.trim();

  await attendance.save();

  registeredDevice.lastUsedAt = now;
  await registeredDevice.save();

  logActivity({
    req,
    action: "ATTENDANCE_CHECK_OUT",
    entityType: "Attendance",
    entityId: attendance._id,
    description: `Staff '${req.user.name}' checked out. Total working duration: ${Math.floor(workingMinutes / 60)}h ${workingMinutes % 60}m.`,
    metadata: { workingMinutes, distance: distanceFromOffice }
  });

  res.status(200).json({
    success: true,
    message: `Checked out successfully! Total working time: ${Math.floor(workingMinutes / 60)}h ${workingMinutes % 60}m.`,
    data: attendance,
  });
});

/**
 * @desc    Get employee's personal attendance history
 * @route   GET /api/attendance/history
 * @access  Private (All staff)
 */
const getMyAttendanceHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 15, startDate, endDate, date, specificDate, period, status } = req.query;

  const query = {
    employee: req.user._id || req.user.id,
  };

  if (startDate || endDate) {
    query.attendanceDate = {};
    if (startDate) query.attendanceDate.$gte = startDate;
    if (endDate) query.attendanceDate.$lte = endDate;
  } else if (specificDate || date) {
    query.attendanceDate = specificDate || date;
  } else if (period) {
    if (period === "daily") {
      query.attendanceDate = getDhakaDateString();
    } else if (period === "weekly") {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
      query.attendanceDate = {
        $gte: getDhakaDateString(weekAgo),
        $lte: getDhakaDateString(today),
      };
    } else if (period === "monthly") {
      const currentMonth = getDhakaDateString().substring(0, 7);
      query.attendanceDate = { $regex: `^${currentMonth}` };
    }
  }

  if (status && status !== "all" && status !== "") {
    if (status === "late") {
      query.$or = [{ status: "late" }, { late: true }];
    } else {
      query.status = status;
    }
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 15;
  const skip = (pageNum - 1) * limitNum;

  const total = await Attendance.countDocuments(query);
  const records = await Attendance.find(query)
    .sort({ attendanceDate: -1, checkInAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  res.status(200).json({
    success: true,
    count: records.length,
    total,
    totalPages: Math.ceil(total / limitNum),
    currentPage: pageNum,
    data: records,
  });
});

// ============================================================
// ADMIN APIS
// ============================================================

/**
 * @desc    Get all staff attendance with daily summary stats
 * @route   GET /api/attendance/admin
 * @access  Private (Admin only)
 */
const getAllAttendanceAdmin = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 15,
    search = "",
    date,
    specificDate,
    period,
    startDate,
    endDate,
    status = "all",
    role = "all",
  } = req.query;

  const targetDate = specificDate || date || getDhakaDateString();

  // 1. Compute Daily Summary Stats for Target Date (Tracked staff: manager, employee, salesman)
  const allStaffUsers = await User.find({
    role: { $in: ["manager", "employee", "salesman"] },
  }).select("_id name email role employeeId");

  const totalStaffCount = allStaffUsers.length;

  const todayRecords = await Attendance.find({
    attendanceDate: targetDate,
  }).lean();

  const presentCount = todayRecords.filter(
    (r) => r.status === "present" || (r.status === "checked_out" && !r.late)
  ).length;

  const lateCount = todayRecords.filter(
    (r) => r.late || r.status === "late"
  ).length;

  const workingCount = todayRecords.filter(
    (r) => r.status === "working" && !r.checkOutAt
  ).length;

  const checkedOutCount = todayRecords.filter((r) => r.checkOutAt !== null).length;

  // Check approved leaves for targetDate (read-only query)
  let onLeaveCount = 0;
  try {
    const targetDateObj = new Date(targetDate);
    const approvedLeaves = await Leave.find({
      status: "approved",
      $or: [
        { date: targetDateObj },
        {
          fromDate: { $lte: targetDateObj },
          toDate: { $gte: targetDateObj },
        },
      ],
    }).select("applicant");
    onLeaveCount = approvedLeaves.length;
  } catch (e) {
    // Ignore if leave collection is empty
  }

  const attendedEmployeeIds = new Set(
    todayRecords
      .filter((r) => r && r.employee)
      .map((r) => r.employee.toString())
  );

  const absentCount = Math.max(
    0,
    totalStaffCount - attendedEmployeeIds.size - onLeaveCount
  );

  const stats = {
    totalEmployees: totalStaffCount,
    totalStaff: totalStaffCount,
    present: presentCount,
    presentCount,
    late: lateCount,
    lateCount,
    working: workingCount,
    workingCount,
    checkedOut: checkedOutCount,
    checkedOutCount,
    onLeave: onLeaveCount,
    onLeaveCount,
    absent: absentCount,
    absentCount,
  };

  // 2. Build Query for Records Table
  const query = {};

  if (startDate || endDate) {
    query.attendanceDate = {};
    if (startDate) query.attendanceDate.$gte = startDate;
    if (endDate) query.attendanceDate.$lte = endDate;
  } else if (specificDate || date) {
    query.attendanceDate = specificDate || date;
  } else if (period) {
    if (period === "daily") {
      query.attendanceDate = getDhakaDateString();
    } else if (period === "weekly") {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
      query.attendanceDate = {
        $gte: getDhakaDateString(weekAgo),
        $lte: getDhakaDateString(today),
      };
    } else if (period === "monthly") {
      const currentMonth = getDhakaDateString().substring(0, 7);
      query.attendanceDate = { $regex: `^${currentMonth}` };
    }
    // period === 'all' -> no attendanceDate filter
  } else {
    // Default fallback to today's date if no date/period provided
    query.attendanceDate = getDhakaDateString();
  }

  if (status && status !== "all" && status !== "") {
    if (status === "late") {
      query.$or = [{ status: "late" }, { late: true }];
    } else {
      query.status = status;
    }
  }

  if (role && role !== "all" && role !== "") {
    const userIdsWithRole = await User.find({ role }).distinct("_id");
    const roleCondition = {
      $or: [
        { employeeRole: role },
        { employee: { $in: userIdsWithRole } },
      ],
    };

    if (query.$or) {
      query.$and = [{ $or: query.$or }, roleCondition];
      delete query.$or;
    } else if (query.$and) {
      query.$and.push(roleCondition);
    } else {
      query.$or = roleCondition.$or;
    }
  }

  if (search && search.trim()) {
    const s = search.trim();
    const matchingUsers = await User.find({
      $or: [
        { name: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { employeeId: { $regex: s, $options: "i" } },
      ],
    }).distinct("_id");

    const searchCondition = {
      $or: [
        { employeeName: { $regex: s, $options: "i" } },
        { employeeEmail: { $regex: s, $options: "i" } },
        { employeeId: { $regex: s, $options: "i" } },
        { employee: { $in: matchingUsers } },
      ],
    };

    if (query.$or) {
      query.$and = [{ $or: query.$or }, searchCondition];
      delete query.$or;
    } else if (query.$and) {
      query.$and.push(searchCondition);
    } else {
      query.$or = searchCondition.$or;
    }
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 15;
  const skip = (pageNum - 1) * limitNum;

  const total = await Attendance.countDocuments(query);
  const records = await Attendance.find(query)
    .populate("employee", "name email role phone employeeId avatar")
    .sort({ attendanceDate: -1, checkInAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  res.status(200).json({
    success: true,
    data: records,
    stats,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      total,
      limit: limitNum,
    },
  });
});

/**
 * @desc    Get single attendance record details
 * @route   GET /api/attendance/:id
 * @access  Private (Admin or record owner)
 */
const getAttendanceDetails = asyncHandler(async (req, res) => {
  const attendance = await Attendance.findById(req.params.id)
    .populate("employee", "name email role phone employeeId avatar")
    .populate("correctionAudit.modifiedBy", "name email role")
    .lean();

  if (!attendance) {
    return res.status(404).json({
      success: false,
      message: "Attendance record not found",
    });
  }

  const settings = await AttendanceSettings.getSettings();

  res.status(200).json({
    success: true,
    data: {
      attendance,
      officeSettings: {
        officeName: settings.officeName,
        latitude: settings.latitude,
        longitude: settings.longitude,
        allowedRadius: settings.allowedRadius,
      },
    },
  });
});

/**
 * @desc    Admin Manual Correction of Attendance Record
 * @route   PATCH /api/attendance/:id
 * @access  Private (Admin only)
 */
const manualCorrection = asyncHandler(async (req, res) => {
  const { checkInAt, checkOutAt, status, late, lateMinutes, reason, notes } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: "Correction reason is required for administrative audit trail.",
    });
  }

  const attendance = await Attendance.findById(req.params.id);
  if (!attendance) {
    return res.status(404).json({
      success: false,
      message: "Attendance record not found",
    });
  }

  const previousValue = {
    checkInAt: attendance.checkInAt,
    checkOutAt: attendance.checkOutAt,
    workingMinutes: attendance.workingMinutes,
    status: attendance.status,
    late: attendance.late,
    lateMinutes: attendance.lateMinutes,
    notes: attendance.notes,
  };

  if (checkInAt !== undefined) attendance.checkInAt = checkInAt ? new Date(checkInAt) : null;
  if (checkOutAt !== undefined) attendance.checkOutAt = checkOutAt ? new Date(checkOutAt) : null;
  if (status !== undefined) attendance.status = status;
  if (late !== undefined) attendance.late = Boolean(late);
  if (lateMinutes !== undefined) attendance.lateMinutes = Number(lateMinutes);
  if (notes !== undefined) attendance.notes = notes.trim();

  // Recalculate working duration
  if (attendance.checkInAt && attendance.checkOutAt) {
    attendance.workingMinutes = calculateWorkingMinutes(
      attendance.checkInAt,
      attendance.checkOutAt
    );
  }

  const newValue = {
    checkInAt: attendance.checkInAt,
    checkOutAt: attendance.checkOutAt,
    workingMinutes: attendance.workingMinutes,
    status: attendance.status,
    late: attendance.late,
    lateMinutes: attendance.lateMinutes,
    notes: attendance.notes,
  };

  // Add audit record
  attendance.correctionAudit.push({
    modifiedBy: req.user._id || req.user.id,
    modifiedByName: req.user.name || "Admin",
    modifiedAt: new Date(),
    reason: reason.trim(),
    previousValue,
    newValue,
  });

  await attendance.save();

  logActivity({
    req,
    action: "CORRECT_ATTENDANCE",
    entityType: "Attendance",
    entityId: attendance._id,
    description: `Admin '${req.user.name}' manually updated attendance for '${attendance.employeeName}'. Reason: "${reason.trim()}"`,
    metadata: { previousValue, newValue, reason: reason.trim() }
  });

  res.status(200).json({
    success: true,
    message: "Attendance record updated successfully with audit trail.",
    data: attendance,
  });
});

/**
 * @desc    Get Attendance Settings
 * @route   GET /api/attendance/settings
 * @access  Private (Admin only)
 */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await AttendanceSettings.getSettings();
  res.status(200).json({
    success: true,
    data: settings,
  });
});

/**
 * @desc    Update Attendance Settings
 * @route   PUT /api/attendance/settings
 * @access  Private (Admin only)
 */
const updateSettings = asyncHandler(async (req, res) => {
  const {
    officeName,
    latitude,
    longitude,
    allowedRadius,
    attendanceEnabled,
    workStartTime,
    workEndTime,
    lateThresholdMinutes,
    maxGpsAccuracy,
  } = req.body;

  const settings = await AttendanceSettings.getSettings();

  // Validate latitude & longitude
  if (latitude !== undefined && latitude !== null && latitude !== "") {
    const lat = Number(latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        message: "Latitude must be a valid number between -90 and 90.",
      });
    }
    settings.latitude = lat;
  }

  if (longitude !== undefined && longitude !== null && longitude !== "") {
    const lon = Number(longitude);
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({
        success: false,
        message: "Longitude must be a valid number between -180 and 180.",
      });
    }
    settings.longitude = lon;
  }

  if (allowedRadius !== undefined) {
    const rad = Number(allowedRadius);
    if (isNaN(rad) || rad <= 0) {
      return res.status(400).json({
        success: false,
        message: "Allowed radius must be a positive number in meters.",
      });
    }
    settings.allowedRadius = rad;
  }

  if (maxGpsAccuracy !== undefined) {
    const acc = Number(maxGpsAccuracy);
    if (isNaN(acc) || acc <= 0) {
      return res.status(400).json({
        success: false,
        message: "Maximum GPS accuracy must be a positive number.",
      });
    }
    settings.maxGpsAccuracy = acc;
  }

  if (workStartTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(workStartTime)) {
      return res.status(400).json({
        success: false,
        message: "Work start time must be in HH:mm format.",
      });
    }
    settings.workStartTime = workStartTime;
  }

  if (workEndTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(workEndTime)) {
      return res.status(400).json({
        success: false,
        message: "Work end time must be in HH:mm format.",
      });
    }
    settings.workEndTime = workEndTime;
  }

  if (lateThresholdMinutes !== undefined) {
    const thresh = Number(lateThresholdMinutes);
    if (isNaN(thresh) || thresh < 0) {
      return res.status(400).json({
        success: false,
        message: "Late threshold must be a non-negative number of minutes.",
      });
    }
    settings.lateThresholdMinutes = thresh;
  }

  if (officeName !== undefined && officeName.trim()) {
    settings.officeName = officeName.trim();
  }

  // Safe Attendance Enablement validation
  if (attendanceEnabled !== undefined) {
    const enableVal = Boolean(attendanceEnabled);
    if (enableVal) {
      if (
        settings.latitude === null ||
        settings.longitude === null ||
        isNaN(settings.latitude) ||
        isNaN(settings.longitude)
      ) {
        return res.status(400).json({
          success: false,
          message: "Please configure a valid office latitude and longitude before enabling Attendance.",
        });
      }
    }
    settings.attendanceEnabled = enableVal;
  }

  await settings.save();

  logActivity({
    req,
    action: "UPDATE_ATTENDANCE_SETTINGS",
    entityType: "AttendanceSettings",
    entityId: settings._id,
    description: `Admin '${req.user.name}' updated attendance settings (Enabled: ${settings.attendanceEnabled}, Radius: ${settings.allowedRadius}m)`,
    metadata: { settings }
  });

  res.status(200).json({
    success: true,
    message: "Attendance settings updated successfully.",
    data: settings,
  });
});

/**
 * @desc    Get all registered devices
 * @route   GET /api/attendance/devices
 * @access  Private (Admin only)
 */
const getRegisteredDevices = asyncHandler(async (req, res) => {
  const { search } = req.query;

  let query = {};
  const devices = await AttendanceDevice.find(query)
    .populate("employee", "name email role phone employeeId avatar")
    .sort({ lastUsedAt: -1 })
    .lean();

  let filtered = devices;
  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = devices.filter((d) => {
      const name = (d.employee?.name || "").toLowerCase();
      const email = (d.employee?.email || "").toLowerCase();
      const empId = (d.employee?.employeeId || "").toLowerCase();
      const dName = (d.deviceName || "").toLowerCase();
      const dId = (d.deviceId || "").toLowerCase();
      return (
        name.includes(s) ||
        email.includes(s) ||
        empId.includes(s) ||
        dName.includes(s) ||
        dId.includes(s)
      );
    });
  }

  res.status(200).json({
    success: true,
    count: filtered.length,
    data: filtered,
  });
});

/**
 * @desc    Reset / Delete an employee's registered device
 * @route   DELETE /api/attendance/devices/:id
 * @access  Private (Admin only)
 */
const resetDevice = asyncHandler(async (req, res) => {
  const device = await AttendanceDevice.findById(req.params.id).populate("employee", "name email");

  if (!device) {
    return res.status(404).json({
      success: false,
      message: "Device record not found.",
    });
  }

  await AttendanceDevice.findByIdAndDelete(req.params.id);

  logActivity({
    req,
    action: "RESET_ATTENDANCE_DEVICE",
    entityType: "AttendanceDevice",
    entityId: device._id,
    description: `Admin '${req.user.name}' removed registered device for staff '${device.employee?.name || "Employee"}'. Staff can now register a new device inside the office.`,
    metadata: { employeeId: device.employee?._id, deviceId: device.deviceId }
  });

  res.status(200).json({
    success: true,
    message: "Device record reset successfully. The employee can now register a new device.",
  });
});

/**
 * @desc    Get monthly attendance calendar matrix & graphical statistics for all staff
 * @route   GET /api/attendance/monthly-summary
 * @access  Private (Admin only)
 */
const getMonthlyAttendanceSummary = asyncHandler(async (req, res) => {
  const { month, role, search, page = 1, limit = 20, pagination } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 20);
  const skip = (pageNum - 1) * limitNum;

  const currentDhaka = getDhakaDateString(); // "YYYY-MM-DD"
  const currentMonth = currentDhaka.substring(0, 7); // "YYYY-MM"
  const selectedMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth;

  const [yearStr, monthNumStr] = selectedMonth.split("-");
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthNumStr, 10);

  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const startDateStr = `${selectedMonth}-01`;
  const endDateStr = `${selectedMonth}-${String(daysInMonth).padStart(2, "0")}`;

  // 1. Query staff users (Exclude admin, only track manager, employee, salesman)
  const userQuery = {
    role: { $in: ["manager", "employee", "salesman"] },
  };
  if (role && role !== "all") {
    userQuery.role = role;
  }
  if (search && search.trim()) {
    const s = search.trim();
    userQuery.$or = [
      { name: { $regex: s, $options: "i" } },
      { email: { $regex: s, $options: "i" } },
      { employeeId: { $regex: s, $options: "i" } },
    ];
  }

  const totalStaffCount = await User.countDocuments(userQuery);

  let staffUsersQuery = User.find(userQuery)
    .select("_id name email role employeeId avatar phone")
    .sort({ role: 1, name: 1 });

  if (pagination !== "false") {
    staffUsersQuery = staffUsersQuery.skip(skip).limit(limitNum);
  }

  const staffUsers = await staffUsersQuery.lean();

  // 2. Fetch monthly attendance records
  const attendanceRecords = await Attendance.find({
    attendanceDate: { $gte: startDateStr, $lte: endDateStr },
  }).lean();

  const attendanceMap = new Map();
  for (const record of attendanceRecords) {
    if (!record.employee) continue;
    const empId = record.employee.toString();
    if (!attendanceMap.has(empId)) {
      attendanceMap.set(empId, new Map());
    }
    attendanceMap.get(empId).set(record.attendanceDate, record);
  }

  // 3. Fetch approved leaves for the month
  let leavesMap = new Map();
  try {
    const startObj = new Date(`${startDateStr}T00:00:00.000Z`);
    const endObj = new Date(`${endDateStr}T23:59:59.999Z`);
    const approvedLeaves = await Leave.find({
      status: "approved",
      $or: [
        { date: { $gte: startObj, $lte: endObj } },
        { fromDate: { $lte: endObj }, toDate: { $gte: startObj } },
      ],
    }).lean();

    for (const leave of approvedLeaves) {
      if (!leave.applicant) continue;
      const applicantId = leave.applicant.toString();
      if (!leavesMap.has(applicantId)) {
        leavesMap.set(applicantId, []);
      }
      leavesMap.get(applicantId).push(leave);
    }
  } catch (e) {
    // Ignore if leave collection is empty or not found
  }

  // 4. Compute statistics & daily map per staff
  let companyTotalPresentCheckins = 0;
  let companyTotalLateCheckins = 0;
  let companyTotalWorkMinutes = 0;
  let companyTotalAbsentDays = 0;

  const staffSummaries = staffUsers.map((staff) => {
    const empId = staff._id.toString();
    const userRecords = attendanceMap.get(empId) || new Map();
    const userLeaves = leavesMap.get(empId) || [];

    const dailyData = {};
    let presentDaysCount = 0;
    let lateDaysCount = 0;
    let workingMinutesTotal = 0;
    let leaveDaysCount = 0;
    let absentDaysCount = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${selectedMonth}-${String(day).padStart(2, "0")}`;
      const isPastDay = dayStr < currentDhaka;
      const isToday = dayStr === currentDhaka;
      const record = userRecords.get(dayStr);

      const isLeave = userLeaves.some((l) => {
        if (l.date && l.date.toISOString().startsWith(dayStr)) return true;
        if (l.fromDate && l.toDate) {
          const f = l.fromDate.toISOString().substring(0, 10);
          const t = l.toDate.toISOString().substring(0, 10);
          return dayStr >= f && dayStr <= t;
        }
        return false;
      });

      if (record) {
        const isPresent =
          record.status === "present" ||
          record.status === "checked_out" ||
          record.status === "working" ||
          !record.late;
        const isLate = Boolean(record.late || record.status === "late");

        if (isPresent || isLate) {
          presentDaysCount += 1;
        }
        if (isLate) {
          lateDaysCount += 1;
        }

        workingMinutesTotal += record.workingMinutes || 0;

        dailyData[dayStr] = {
          date: dayStr,
          day,
          status: record.status || (isLate ? "late" : "present"),
          checkInAt: record.checkInAt,
          checkOutAt: record.checkOutAt,
          workingMinutes: record.workingMinutes || 0,
          late: isLate,
          lateMinutes: record.lateMinutes || 0,
          location: record.checkInLocation,
          deviceId: record.checkInDeviceId,
          auditNotes: record.notes || record.correctionAudit?.reason || "",
        };
      } else if (isLeave) {
        leaveDaysCount += 1;
        dailyData[dayStr] = {
          date: dayStr,
          day,
          status: "leave",
          notes: "Approved Leave",
        };
      } else if (isPastDay) {
        absentDaysCount += 1;
        dailyData[dayStr] = {
          date: dayStr,
          day,
          status: "absent",
        };
      } else if (isToday) {
        dailyData[dayStr] = {
          date: dayStr,
          day,
          status: "today",
        };
      } else {
        dailyData[dayStr] = {
          date: dayStr,
          day,
          status: "future",
        };
      }
    }

    const passedDaysCount =
      selectedMonth === currentMonth
        ? parseInt(currentDhaka.substring(8, 10), 10)
        : selectedMonth < currentMonth
        ? daysInMonth
        : 0;

    absentDaysCount = Math.max(0, passedDaysCount - presentDaysCount - leaveDaysCount);

    companyTotalPresentCheckins += presentDaysCount;
    companyTotalLateCheckins += lateDaysCount;
    companyTotalWorkMinutes += workingMinutesTotal;
    companyTotalAbsentDays += absentDaysCount;

    const attendanceRate =
      passedDaysCount > 0
        ? Math.min(100, Math.round((presentDaysCount / passedDaysCount) * 100))
        : 0;

    return {
      staff: {
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        employeeId: staff.employeeId || "",
        avatar: staff.avatar || null,
        phone: staff.phone || "",
      },
      stats: {
        presentDays: presentDaysCount,
        lateDays: lateDaysCount,
        absentDays: absentDaysCount,
        leaveDays: leaveDaysCount,
        totalWorkingMinutes: workingMinutesTotal,
        totalWorkingHours: (workingMinutesTotal / 60).toFixed(1),
        attendanceRate,
        passedDays: passedDaysCount,
      },
      dailyData,
    };
  });

  const overallStats = {
    totalStaff: totalStaffCount,
    totalPresentCheckins: companyTotalPresentCheckins,
    totalLateCheckins: companyTotalLateCheckins,
    totalAbsentDays: companyTotalAbsentDays,
    totalWorkingHours: (companyTotalWorkMinutes / 60).toFixed(1),
    averageHoursPerStaff:
      totalStaffCount > 0
        ? (companyTotalWorkMinutes / totalStaffCount / 60).toFixed(1)
        : 0,
  };

  res.status(200).json({
    success: true,
    data: {
      month: selectedMonth,
      year,
      monthNumber: monthNum,
      daysInMonth,
      currentDhakaDate: currentDhaka,
      overallStats,
      staffSummaries,
    },
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalStaffCount / limitNum) || 1,
      totalItems: totalStaffCount,
      limit: limitNum,
    },
    stats: overallStats,
  });
});

module.exports = {
  getMyTodayAttendance,
  registerMyDevice,
  checkIn,
  checkOut,
  getMyAttendanceHistory,
  getAllAttendanceAdmin,
  getMonthlyAttendanceSummary,
  getAttendanceDetails,
  manualCorrection,
  getSettings,
  updateSettings,
  getRegisteredDevices,
  resetDevice,
};
