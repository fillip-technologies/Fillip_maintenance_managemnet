// The summary report's period arithmetic (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.INVENTORY_API_ENABLED = 'true';
const { previousPeriod } = await import('../src/modules/inventory/routes/reports.js');

const day = (d) => d.toISOString().slice(0, 10);

test('the previous period has the same number of days, just before', () => {
  const p = previousPeriod(new Date('2026-10-01T00:00:00Z'), new Date('2026-11-30T00:00:00Z'));
  assert.deepEqual([day(p.from), day(p.to)], ['2026-08-01', '2026-09-30']);
});

test('a one-day period is compared with the day before', () => {
  const p = previousPeriod(new Date('2026-11-03T00:00:00Z'), new Date('2026-11-03T00:00:00Z'));
  assert.deepEqual([day(p.from), day(p.to)], ['2026-11-02', '2026-11-02']);
});

const { serviceTokenAccepted } = await import('../src/modules/inventory/auth/middleware.js');

test('the internal summary needs the service token; with none set only development lets calls through', () => {
  assert.equal(serviceTokenAccepted('s3cret', 's3cret', 'production'), true);
  assert.equal(serviceTokenAccepted('s3cret', 'wrong!', 'production'), false);
  assert.equal(serviceTokenAccepted('s3cret', undefined, 'development'), false);
  assert.equal(serviceTokenAccepted('', undefined, 'production'), false);
  assert.equal(serviceTokenAccepted('', undefined, 'test'), false);
  assert.equal(serviceTokenAccepted('', undefined, 'development'), true);
});

const { countVisits, todayWindow } = await import('../src/modules/inventory/routes/reports.js');

test("today's visits: a scheduled visit past its time is escalated, cancelled ones are left out", () => {
  const now = new Date('2026-11-12T12:00:00');
  const at = (time) => new Date(`2026-11-12T${time}`);
  const counts = countVisits(
    [
      { status: 'completed', scheduledAt: at('09:00:00') },
      { status: 'in_progress', scheduledAt: at('10:00:00') },
      { status: 'scheduled', scheduledAt: at('11:00:00') },
      { status: 'scheduled', scheduledAt: at('15:00:00') },
      { status: 'cancelled', scheduledAt: at('08:00:00') },
    ],
    now,
  );
  assert.deepEqual(counts, { completed: 1, in_progress: 1, pending: 1, escalated: 1 });
});

test("today is the server's own day, midnight to midnight", () => {
  const { start, end } = todayWindow(new Date('2026-11-12T18:30:00'));
  assert.equal(start.getTime(), new Date('2026-11-12T00:00:00').getTime());
  assert.equal(end.getTime(), new Date('2026-11-13T00:00:00').getTime());
});
