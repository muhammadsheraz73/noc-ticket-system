import env from './config/env.js';
import logger from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { backfillUsernames } from './scripts/backfillUsernames.js';
import { createApp } from './app.js';
import { aiStatusInfo } from './services/aiService.js';

async function main() {
  await connectDatabase();

  // Accounts predating the username field cannot be saved until they have one,
  // so an existing deployment repairs itself on the first start after upgrade.
  const backfilled = await backfillUsernames();
  if (backfilled) logger.info(`Assigned usernames to ${backfilled} existing account(s).`);

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('------------------------------------------------------------');
    logger.info(`  NOC Ticket Management System — API`);
    logger.info(`  Environment : ${env.nodeEnv}`);
    logger.info(`  API         : http://localhost:${env.port}/api`);
    logger.info(`  Health      : http://localhost:${env.port}/api/health`);
    logger.info(`  Timezone    : ${env.timezone}`);
    logger.info(`  AI assistant: ${aiStatusInfo().status}`);
    logger.info('------------------------------------------------------------');
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down.`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Force exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
}

main().catch((error) => {
  logger.error('Failed to start the server:', error.message);
  logger.error(error.stack);
  process.exit(1);
});
