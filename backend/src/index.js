import dotenv from 'dotenv';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startExpiryJob } from './services/alertService.js';
import { startDispatchSweeps } from './services/dispatchService.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

try {
  await connectDB();
  startExpiryJob();
  startDispatchSweeps();
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
