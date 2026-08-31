import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Single PrismaClient instance for the whole process. In development the
 * module can be re-evaluated by the watcher, so we cache the client on
 * globalThis to avoid exhausting the database connection pool.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: isProduction
      ? [{ level: 'error', emit: 'event' }]
      : [
          { level: 'query', emit: 'event' },
          { level: 'error', emit: 'event' },
          { level: 'warn', emit: 'event' },
        ],
  });

prisma.$on('error', (e) => logger.error({ prisma: e }, 'Prisma error'));
if (!isProduction) {
  prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'Prisma warning'));
  prisma.$on('query', (e) =>
    logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'Prisma query')
  );
}

if (!isProduction) {
  globalForPrisma.__prisma = prisma;
}
