const express = require("express");
const router = express.Router();
const {
  getActivityLogs,
  deleteActivityLog,
  clearAllActivityLogs,
} = require("../controllers/activityLogController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @route   GET /api/admin/activity-logs
 * @desc    Get paginated employee activity logs
 * @access  Private (Admin or activity_logs.view)
 */
router.get("/", authenticate, authorize("admin", "activity_logs.view"), getActivityLogs);

/**
 * @route   DELETE /api/admin/activity-logs/:id
 * @desc    Delete single activity log record
 * @access  Private (Admin or activity_logs.view)
 */
router.delete("/:id", authenticate, authorize("admin", "activity_logs.view"), deleteActivityLog);

/**
 * @route   DELETE /api/admin/activity-logs
 * @desc    Clear all activity logs
 * @access  Private (Admin Only)
 */
router.delete("/", authenticate, authorize("admin"), clearAllActivityLogs);

module.exports = router;
