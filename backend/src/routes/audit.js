import { Router } from 'express';
import { z } from 'zod';
import AuditLog from '../models/AuditLog.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();
router.use(requireAuth, requireRole('DMC_OFFICER', 'DISTRICT_OFFICER'));

// GET /api/audit?action=&limit= — mutation trail for the dashboards.
router.get('/audit', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await AuditLog.find(filter).sort({ at: -1 }).limit(limit);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

export default router;
