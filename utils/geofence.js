/**
 * ============================================================
 * utils/geofence.js — Geographic Distance & Timezone Utilities
 * ============================================================
 * Calculates exact great-circle distance between two GPS points
 * using the Haversine formula and provides Asia/Dhaka date helpers.
 * ============================================================
 */

/**
 * Calculates distance between two coordinates in meters using Haversine formula
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters rounded to nearest integer
 */
const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distance in meters
};

/**
 * Returns date string in YYYY-MM-DD format for Asia/Dhaka timezone
 * @param {Date} date 
 * @returns {string} YYYY-MM-DD
 */
const getDhakaDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

/**
 * Parses time string like "09:00" to minutes from midnight
 * @param {string} timeStr "HH:mm"
 * @returns {number}
 */
const timeStringToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Calculates working minutes between two dates
 * @param {Date} start 
 * @param {Date} end 
 * @returns {number}
 */
const calculateWorkingMinutes = (start, end) => {
  if (!start || !end) return 0;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60)));
};

module.exports = {
  calculateHaversineDistance,
  getDhakaDateString,
  timeStringToMinutes,
  calculateWorkingMinutes,
};
