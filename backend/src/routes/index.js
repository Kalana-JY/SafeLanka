import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'safelanka-backend', timestamp: new Date().toISOString() });
});

router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from SafeLanka backend' });
});

export default router;
