import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import env, { SERVER_ROOT } from './config/env.js';
import { IS_SERVERLESS } from './config/db.js';
import logger from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customers.routes.js';
import ticketRoutes from './routes/tickets.routes.js';
import invoiceRoutes from './routes/invoices.routes.js';
import searchRoutes from './routes/search.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import fieldTeamRoutes from './routes/fieldTeams.routes.js';
import networkRoutes from './routes/network.routes.js';
import userRoutes from './routes/users.routes.js';
import aiRoutes from './routes/ai.routes.js';
import metaRoutes from './routes/meta.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // React sets inline `style` attributes, and the invoice PDF is shown in a
      // blob: iframe — both need to be allowed explicitly.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: env.isProduction ? [] : null,
        },
      },
    }),
  );
  app.use(compression());

  app.use((req, res, next) => {
    // The client always calls the relative `/api` path, so in every real
    // deployment (Vercel, Render, ...) the API is served from the same host
    // the page was loaded from — but browsers still attach an Origin header
    // on same-origin fetch/XHR calls. Trust that self-origin automatically
    // instead of requiring CORS_ORIGINS to be kept in sync with every
    // Vercel preview URL; CORS_ORIGINS remains for genuinely cross-origin
    // setups (e.g. a separately hosted frontend).
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    return cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests carry no Origin header.
        if (!origin) return callback(null, true);
        if (origin === selfOrigin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    })(req, res, next);
  });

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  if (!env.isProduction) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      serverTime: new Date(),
      timezone: env.timezone,
      version: '1.0.0',
    });
  });

  app.use('/api', apiLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/field-teams', fieldTeamRoutes);
  app.use('/api/network', networkRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/meta', metaRoutes);

  // Any /api path that reached this point does not exist.
  app.use('/api', notFoundHandler);

  serveWebApp(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * In a deployed build the API also serves the compiled React app, so the whole
 * system runs as a single service on one origin (no CORS, one URL, one process).
 * In development the Vite dev server handles this instead.
 */
function serveWebApp(app) {
  // On a serverless platform the CDN serves the built app straight from
  // client/dist, so the function never sees a non-API request.
  if (IS_SERVERLESS) return;

  const dist = path.resolve(SERVER_ROOT, '..', 'client', 'dist');
  const indexHtml = path.join(dist, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    if (env.isProduction) {
      logger.warn(`Web app not found at ${dist} — run "npm run build" before starting in production.`);
    }
    return;
  }

  // Hashed asset filenames can be cached hard; index.html must never be.
  app.use(
    express.static(dist, {
      index: false,
      maxAge: env.isProduction ? '1y' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // Client-side routing: every non-API GET returns the SPA shell.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(indexHtml);
  });

  logger.info('Web app: serving the compiled React build from client/dist');
}

export default createApp;
