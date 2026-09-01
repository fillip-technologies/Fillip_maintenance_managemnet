import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { initRealtime } from './realtime/socket.js';
import { initPush } from './push/provider.js';
import { initPushNotifier } from './push/notifier.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

// Attach Socket.IO to the same HTTP server.
initRealtime(server);

// Initialize FCM (no-op when unconfigured) and subscribe push to domain events.
initPush();
initPushNotifier();

/**
 * Graceful shutdown: stop accepting connections, drain in-flight requests,
 * then close the DB pool. A hard timeout guards against hung connections.
 */
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      clearTimeout(forceExit);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });
}

['SIGINT', 'SIGTERM'].forEach((signal) =>
  process.on(signal, () => shutdown(signal))
);

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
