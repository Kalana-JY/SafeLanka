import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import User from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  blacklistRefresh,
  isRefreshBlacklisted
} from '../utils/jwt.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();

// Brute-force guard on auth endpoints (v1 values; tighten in production).
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120 }));

const signupSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().max(160),
  mobileNo: z.string().min(7).max(20),
  password: z.string().min(6).max(128),
  // English-only: accept legacy si/ta but always store 'en'.
  preferredLanguage: z.enum(['si', 'ta', 'en']).default('en').transform(() => 'en'),
  district: z.string().min(1).max(80)
});

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function tokensFor(user) {
  return { accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) };
}

// Citizen self-signup only. Role is forced to CITIZEN.
router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { fullName, email, mobileNo, password, preferredLanguage, district } = req.body;
    const existing = await User.findOne({ $or: [{ email }, { mobileNo }] });
    if (existing) return res.status(409).json({ error: 'Email or mobile number already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      fullName,
      email,
      mobileNo,
      passwordHash,
      role: 'CITIZEN',
      preferredLanguage,
      district
    });
    recordAudit(user._id.toString(), 'USER_SIGNUP', 'User', user._id.toString());
    res.status(201).json({ user: user.toJSON(), ...tokensFor(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/signin', validate(signinSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ error: 'Account inactive' });
    recordAudit(user._id.toString(), 'USER_SIGNIN', 'User', user._id.toString());
    res.json({ user: user.toJSON(), ...tokensFor(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(401).json({ error: 'Missing refresh token' });
  if (isRefreshBlacklisted(refreshToken)) return res.status(401).json({ error: 'Refresh token revoked' });
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Account not found or inactive' });
  res.json({ accessToken: signAccessToken(user) });
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) blacklistRefresh(refreshToken);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toJSON() });
});

export default router;
