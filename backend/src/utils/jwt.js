import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-change-me';

if (!process.env.JWT_SECRET) console.warn('[auth] JWT_SECRET not set, using dev fallback');
if (!process.env.JWT_REFRESH_SECRET) console.warn('[auth] JWT_REFRESH_SECRET not set, using dev fallback');

// v1 refresh blacklist (in-memory; use Redis/DB in production)
const refreshBlacklist = new Set();

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, email: user.email },
    ACCESS_SECRET,
    { expiresIn: '1h' }
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString() }, REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

export function blacklistRefresh(token) {
  refreshBlacklist.add(token);
}

export function isRefreshBlacklisted(token) {
  return refreshBlacklist.has(token);
}
