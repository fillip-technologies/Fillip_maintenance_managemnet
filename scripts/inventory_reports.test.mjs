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
