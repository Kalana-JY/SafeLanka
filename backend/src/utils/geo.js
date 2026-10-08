import User from '../models/User.js';
import { ALERT_LANGUAGES } from '../models/Alert.js';

const RECIPIENT_ROLES = ['CITIZEN', 'VOLUNTEER'];

function asDistrictList(districts) {
  const raw = Array.isArray(districts) ? districts : districts ? [districts] : [];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const name = String(value ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function languageOf(preferredLanguage) {
  return ALERT_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
}

// Eligible recipients: active, opted-in citizens and volunteers in the given districts.
export async function resolveRecipients(districts) {
  const list = asDistrictList(districts);
  if (!list.length) return [];
  return User.find({
    district: { $in: list },
    active: true,
    alertOptIn: true,
    role: { $in: RECIPIENT_ROLES }
  }).select('_id preferredLanguage district');
}

// One read of recipient-role users in the area, then counts derived in memory.
// `excluded` is active citizens/volunteers inside the area who opted out.
// Inactive users and people outside the area are not included in `excluded`.
export async function summarizeReach(districts) {
  const list = asDistrictList(districts);
  const languages = { en: 0, si: 0, ta: 0 };
  if (!list.length) {
    return { reach: 0, excluded: 0, districts: [], languages };
  }

  const users = await User.find({
    district: { $in: list },
    role: { $in: RECIPIENT_ROLES }
  })
    .select('district preferredLanguage alertOptIn active')
    .lean();

  const eligible = users.filter((user) => user.active && user.alertOptIn);
  const excluded = users.filter((user) => user.active && user.alertOptIn === false).length;
  for (const user of eligible) languages[languageOf(user.preferredLanguage)] += 1;

  return {
    reach: eligible.length,
    excluded,
    districts: list.map((district) => ({
      district,
      eligible: eligible.filter((user) => user.district === district).length
    })),
    languages
  };
}

export async function countRecipients(districts) {
  const summary = await summarizeReach(districts);
  return summary.reach;
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
