import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * Notifications through FBOS Communication, the way Delivery does it: an outbox
 * row written in the same transaction as the change, and a worker that posts
 * it to Communication's /internal/notifications with `source_event_id` (the row
 * id) so a retry never notifies twice. FBOS has no event bus; other consumers
 * get explicit endpoints later (integration plan §5.6).
 *
 * `notify`: { title, body?, action_url?, urgency?, subject?: { type, id },
 *             recipient_user_ids?: [], recipient_unit_ids?: [] }
 * Unit recipients are resolved to people by Identity when the row is sent.
 */
export function enqueueNotification(tx, { eventType, aggregateType, aggregateId, notify }) {
  return tx.outbox.create({
    data: {
      organizationId: env.FBOS_ORGANIZATION_ID ?? null,
      eventType,
      aggregateType,
      aggregateId,
      destination: 'communication',
      payload: notify,
    },
  });
}

const MAX_ATTEMPTS = 10;
const backoffMs = (attempts) => Math.min(30_000 * 2 ** attempts, 3_600_000);
const internalHeaders = () => ({
  'content-type': 'application/json',
  ...(env.FBOS_INTERNAL_TOKEN ? { 'X-FBOS-Internal-Token': env.FBOS_INTERNAL_TOKEN } : {}),
});

async function unitPeople(unitId) {
  const url = new URL('/api/identity/v1/internal/people', env.FBOS_IDENTITY_URL);
  url.searchParams.set('organization_id', env.FBOS_ORGANIZATION_ID);
  url.searchParams.set('unit_id', unitId);
  const res = await fetch(url, { headers: internalHeaders(), signal: AbortSignal.timeout(env.FBOS_IDENTITY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Identity people ${res.status}`);
  return ((await res.json()).data ?? []).map((p) => p.id);
}

async function deliver(row) {
  const p = row.payload;
  const recipients = new Set(p.recipient_user_ids ?? []);
  for (const unitId of p.recipient_unit_ids ?? []) {
    for (const id of await unitPeople(unitId)) recipients.add(id);
  }
  if (recipients.size === 0) return 'no_recipients';
  const res = await fetch(new URL('/internal/notifications', env.FBOS_COMMUNICATION_URL), {
    method: 'POST',
    headers: internalHeaders(),
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      organization_id: row.organizationId ?? env.FBOS_ORGANIZATION_ID,
      recipient_user_ids: [...recipients].slice(0, 200),
      event_type: `inventory.${row.eventType}.v1`,
      title: p.title,
      body: p.body ?? '',
      action_url: p.action_url ?? null,
      subject: p.subject ?? null,
      urgency: p.urgency ?? 'normal',
      source_event_id: row.id,
    }),
  });
  if (!res.ok) throw new Error(`Communication ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return 'delivered';
}

/** One round: send what is due. Returns { delivered, failed, skipped }. */
export async function deliverPending({ limit = 20 } = {}) {
  const counts = { delivered: 0, failed: 0, skipped: 0 };
  if (!env.FBOS_COMMUNICATION_URL) return counts;
  const due = await prisma.outbox.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  for (const row of due) {
    try {
      const outcome = await deliver(row);
      await prisma.outbox.update({
        where: { id: row.id },
        data: { status: 'delivered', deliveredAt: new Date(), lastError: outcome === 'no_recipients' ? 'No one to notify' : null, attempts: { increment: 1 } },
      });
      counts[outcome === 'delivered' ? 'delivered' : 'skipped']++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await prisma.outbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: String(err.message ?? err).slice(0, 1000),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      counts.failed++;
      logger.warn({ outboxId: row.id, attempts, err: err.message }, 'Outbox delivery failed');
    }
  }
  return counts;
}

/** Polls every `intervalMs` while the process runs (OUTBOX_WORKER_ENABLED). */
export function startOutboxWorker({ intervalMs = 15_000 } = {}) {
  let running = false;
  let lastNoticeDay = null;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // Once a day: warranty expiry notices become outbox rows like any other.
      const today = new Date().toISOString().slice(0, 10);
      if (lastNoticeDay !== today) {
        const { queueWarrantyNotices } = await import('./warrantyNotices.js');
        const { generateDueVisits } = await import('./maintenance.js');
        await queueWarrantyNotices();
        await generateDueVisits();
        lastNoticeDay = today;
      }
      await deliverPending();
    } catch (err) {
      logger.error({ err }, 'Outbox worker round failed');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
