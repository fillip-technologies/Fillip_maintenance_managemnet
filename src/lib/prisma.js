import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

// Inject pool settings before Prisma reads the URL, so bursts of parallel
// queries (e.g. the 23-query overview) queue safely instead of timing out.
(function patchDbUrl() {
  try {
    const u = new URL(env.DATABASE_URL);
    if (!u.searchParams.has('connection_limit'))
      u.searchParams.set('connection_limit', String(env.PRISMA_POOL_SIZE));
    if (!u.searchParams.has('pool_timeout'))
      u.searchParams.set('pool_timeout', String(env.PRISMA_POOL_TIMEOUT));
    process.env.DATABASE_URL = u.toString();
  } catch {
    // Non-URL connection strings (e.g. file:) — skip silently.
  }
})();

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
