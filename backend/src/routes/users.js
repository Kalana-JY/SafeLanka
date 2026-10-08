import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import User, { ROLES } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth);

// Self-service profile: preferred language, alert opt-in, district, name.
// (Role changes stay DMC-only via PATCH /:id/role.)
router.patch(
  '/me',
  validate(
    z.object({
      fullName: z.string().min(1).max(120).optional(),
      preferredLanguage: z.enum(['si', 'ta', 'en']).optional(),
      alertOptIn: z.boolean().optional(),
      district: z.string().min(1).max(80).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const before = { preferredLanguage: req.user.preferredLanguage, alertOptIn: req.user.alertOptIn, district: req.user.district };
      Object.assign(req.user, req.body);
      await req.user.save();
      recordAudit(req.user._id.toString(), 'PROFILE_UPDATE', 'User', req.user._id.toString(), before, req.body);
      res.json({ user: req.user.toJSON() });
    } catch (err) {
      next(err);
    }
  }
);

const STAFF_ROLES = ['DMC_OFFICER', 'DISTRICT_OFFICER', 'WARDEN', 'TEAM_LEADER'];

const staffSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().max(160),
  mobileNo: z.string().min(7).max(20),
  password: z.string().min(6).max(128),
  role: z.enum(STAFF_ROLES),
  district: z.string().min(1).max(80),
  employeeNo: z.string().min(1).max(40)
});

// District officers may only create field staff. DMC may create any staff role.
router.post(
  '/staff',
  requireRole('DMC_OFFICER', 'DISTRICT_OFFICER'),
  validate(staffSchema),
  async (req, res, next) => {
    try {
      const { role } = req.body;
      if (req.user.role === 'DISTRICT_OFFICER' && !['WARDEN', 'TEAM_LEADER'].includes(role)) {
        return res.status(403).json({ error: 'District officers may only create WARDEN or TEAM_LEADER' });
      }
      const { fullName, email, mobileNo, password, district, employeeNo } = req.body;
      const existing = await User.findOne({ $or: [{ email }, { mobileNo }, { employeeNo }] });
      if (existing) return res.status(409).json({ error: 'Email, mobile or employee number already exists' });

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        fullName,
        email,
        mobileNo,
        passwordHash,
        role,
        district,
        employeeNo,
        preferredLanguage: 'en'
      });
      recordAudit(req.user._id.toString(), 'STAFF_CREATE', 'User', user._id.toString(), null, {
        role
      });
      res.status(201).json({ user: user.toJSON() });
    } catch (err) {
      next(err);
    }
  }
);

// DMC-only role changes (e.g. CITIZEN -> VOLUNTEER upgrades).
router.patch(
  '/:id/role',
  requireRole('DMC_OFFICER'),
  validate(z.object({ role: z.enum(ROLES) })),
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const before = user.role;
      user.role = req.body.role;
      await user.save();
      recordAudit(req.user._id.toString(), 'ROLE_CHANGE', 'User', user._id.toString(), { role: before }, { role: user.role });
      res.json({ user: user.toJSON() });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requireRole('DMC_OFFICER', 'DISTRICT_OFFICER'), async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

export default router;
