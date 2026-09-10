/**
 * Vercel serverless entry point.
 *
 * Vercel does not run a long-lived server, so `server/src/index.js` (which
 * calls `app.listen`) is not used here. Instead each invocation reuses a warm
 * Express app and a cached MongoDB connection.
 *
 * Static files are served by Vercel's CDN straight from `client/dist`
 * (see vercel.json); this function only handles `/api/*`.
 */
import { createApp } from '../server/src/app.js';
import { connectDatabase } from '../server/src/config/db.js';
import logger from '../server/src/utils/logger.js';

// Held on globalThis so a warm container bootstraps once, not per request.
const cache = (globalThis.__nocApp ??= { promise: null });

function bootstrap() {
  if (!cache.promise) {
    cache.promise = (async () => {
      await connectDatabase();
      return createApp();
    })().catch((error) => {
      // Never cache a failed bootstrap — the next request should retry.
      cache.promise = null;
      throw error;
    });
  }
  return cache.promise;
}

export default async function handler(req, res) {
  try {
    const app = await bootstrap();
    return app(req, res);
  } catch (error) {
    logger.error(`Serverless bootstrap failed: ${error.message}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        success: false,
        message:
          'The service could not reach its database. Check MONGODB_URI and that Atlas Network Access allows 0.0.0.0/0.',
      }),
    );
  }
}
