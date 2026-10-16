// @desc    Get staff list for leave application (Manager & Admin)
// @route   GET /api/hrm/leave/staff-list
// @access  Private (Manager, Admin)
const getStaffList = asyncHandler(async (req, res) => {
  const User = require("../models/User");
  const users = await User.find({
    role: { $in: ["salesman", "employee", "manager"] },
  })
    .select("name email role avatar")
    .sort({ name: 1 })
    .lean();

  res.status(200).json({
    success: true,
    data: users,
  });
});
