import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import apiRoutes from './routes/index.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import alertsRouter from './routes/alerts.js';
import reportsRouter from './routes/reports.js';
import verifyRouter from './routes/verify.js';
import sheltersRouter from './routes/shelters.js';
import dispatchRouter from './routes/dispatch.js';
import auditRouter from './routes/audit.js';

const app = express();

// Dynamic origin checker allowing Vite (:5173), Expo Web (:8081, :19006)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8081'
];

if (process.env.EXTRA_ORIGINS) {
  allowedOrigins.push(...process.env.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ name: 'SafeLanka API', status: 'running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api', alertsRouter);
app.use('/api', reportsRouter);
app.use('/api', verifyRouter);
app.use('/api', sheltersRouter);
app.use('/api', dispatchRouter);
app.use('/api', auditRouter);
app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
