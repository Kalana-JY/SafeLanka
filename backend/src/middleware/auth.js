import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Account not found or inactive' });
  }
  req.user = user;
  next();
}
