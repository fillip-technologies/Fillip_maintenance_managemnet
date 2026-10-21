import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Every inventory write transaction runs here, at READ COMMITTED. MariaDB 11's
 * default (REPEATABLE READ with snapshot isolation) fails a transaction with
 * error 1020 when a row it read was changed by another one, which happens
 * whenever two writers take numbers from the same counter (device codes,
 * document numbers). The counters lock with UPDATE and unique keys guard every
 * rule, so READ COMMITTED is enough; a deadlock is retried once.
 */
export async function withTx(fn, { timeout = 30_000, maxWait = 10_000 } = {}) {
  const run = () => prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout, maxWait });
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return run();
    throw err;
  }
}
