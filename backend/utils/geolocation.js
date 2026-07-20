/**
 * Haversine formula – calculates the great-circle distance (in meters)
 * between two points on Earth given their latitude and longitude.
 *
 * @param {number} lat1 – Latitude of point 1 (degrees)
 * @param {number} lng1 – Longitude of point 1 (degrees)
 * @param {number} lat2 – Latitude of point 2 (degrees)
 * @param {number} lng2 – Longitude of point 2 (degrees)
 * @returns {number} Distance in meters
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const EARTH_RADIUS_METERS = 6_371_000;
  const toRadians = (deg) => (deg * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
};

module.exports = { calculateDistance };
