import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { reconcileDeviceStatus } from './modules/devices/device.service.js';
import { issueService } from './modules/issues/issue.service.js';
import { initRealtime } from './realtime/socket.js';
import { initPush } from './push/provider.js';
import { initPushNotifier } from './push/notifier.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

/**
 * Close `resolved` issues that have sat undisputed for AUTO_CLOSE_DAYS. Goes
 * through issueService.transition so it writes a history row, reconciles the
 * device, and emits `issue:updated` like any other close.
 */
async function autoCloseResolvedIssues() {
  const cutoff = new Date(Date.now() - env.AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.issue.findMany({
    where: { status: 'resolved', resolvedAt: { lt: cutoff } },
    select: { id: true, raisedByUserId: true },
    take: 200,
  });
  let closed = 0;
  for (const issue of due) {
    try {
      await issueService.transition(
        issue.id,
        {
          toStatus: 'closed',
          notes: `Auto-closed after ${env.AUTO_CLOSE_DAYS} days with no dispute.`,
          changedByUserId: issue.raisedByUserId,
        },
        null,
        { platform: true },
      );
      closed += 1;
    } catch (err) {
      logger.warn({ err, issueId: issue.id }, 'Auto-close failed for one issue');
    }
  }
  if (closed > 0) logger.info({ closed }, 'Auto-closed resolved issues');
}

// After the server is ready: reconcile every deployed device's derived status
// (heals drift from missed events or manual DB edits) and run one auto-close
// pass. Deferred one tick so the listen callback completes first.
setImmediate(async () => {
  try {
    const devices = await prisma.device.findMany({
      where: { zoneId: { not: null }, status: { notIn: ['retired', 'provisioned'] } },
      select: { id: true },
    });
    for (let i = 0; i < devices.length; i += 10) {
      const batch = devices.slice(i, i + 10);
      await Promise.all(
        batch.map((d) =>
          prisma
            .$transaction((tx) => reconcileDeviceStatus(tx, d.id))
            .catch((err) => logger.warn({ err, deviceId: d.id }, 'reconcile failed for one device')),
        ),
      );
    }
    logger.info({ scanned: devices.length }, 'Startup device-status reconcile complete');
  } catch (err) {
    logger.error({ err }, 'Startup device-status reconcile failed — continuing');
  }

  autoCloseResolvedIssues().catch((err) =>
    logger.error({ err }, 'Startup auto-close pass failed'));
});

// Auto-close sweep, hourly. .unref() so it never blocks a graceful shutdown.
setInterval(() => {
  autoCloseResolvedIssues().catch((err) =>
    logger.error({ err }, 'Auto-close sweep failed'));
}, 60 * 60 * 1000).unref();

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
