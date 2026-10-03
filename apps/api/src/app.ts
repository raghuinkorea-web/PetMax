import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { lookupRouter } from './routes/lookups.js';
import { employeeRouter } from './routes/employees.js';
import { projectRouter } from './routes/projects.js';
import { assignmentRouter } from './routes/assignments.js';
import { timeRouter } from './routes/time.js';
import { expenseRouter } from './routes/expenses.js';
import { leaveRouter } from './routes/leave.js';
import { fileRouter } from './routes/files.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportRouter } from './routes/reports.js';
import { notificationRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { pool } from './lib/db.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    // Receipts are streamed from the API and embedded by the two clients.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: config.isProd ? undefined : false,
  }));

  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);                    // native app / curl
      if (!config.corsOrigins.length) return cb(null, true);  // unconfigured dev
      cb(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Correlation id — echoed in every error body and written to the audit log.
  app.use((req, res, next) => {
    req.requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  if (!config.isProd) {
    app.use((req, _res, next) => {
      if (req.path !== '/api/health') console.log(`  ${req.method} ${req.originalUrl}`);
      next();
    });
  }

  app.use('/api', rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'adisys-fieldops-api', database: 'connected', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.use('/api/auth', authRouter);

  // Everything below this line requires a valid session.
  app.use('/api', authenticate);
  app.use('/api/lookups', lookupRouter);
  app.use('/api/employees', employeeRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/assignments', assignmentRouter);
  app.use('/api/time', timeRouter);
  app.use('/api/expenses', expenseRouter);
  app.use('/api/leave', leaveRouter);
  app.use('/api/files', fileRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/settings', settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
