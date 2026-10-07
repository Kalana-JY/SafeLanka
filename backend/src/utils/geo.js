import User from '../models/User.js';

// v1 recipient resolution: registered, active, opted-in citizens of the district.
// Polygon-level resolution against the National GIS Map Service arrives later;
// district match is the documented simplification (see TargetArea model).
export async function resolveRecipients(district) {
  return User.find({
    district,
    active: true,
    alertOptIn: true,
    role: { $in: ['CITIZEN', 'VOLUNTEER'] }
  }).select('_id');
}

export async function countRecipients(district) {
  return User.countDocuments({
    district,
    active: true,
    alertOptIn: true,
    role: { $in: ['CITIZEN', 'VOLUNTEER'] }
  });
}

// Haversine distance in metres. Used for dedupe radius + sensor proximity.
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
