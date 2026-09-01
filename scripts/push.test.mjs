import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationForEvent, AUDIENCE } from '../src/push/recipients.js';
import { handleIssueEvent } from '../src/push/notifier.js';
import { DOMAIN_EVENT } from '../src/realtime/events.js';

// A minimal issue payload shaped like the `detail` include the services emit.
const issue = (overrides = {}) => ({
  id: 'issue-1',
  status: 'open',
  device: { id: 'dev-1', name: 'Cam - Snake Enclosure East', zoneId: 'zone-1' },
  category: { id: 'cat-1', name: 'no power' },
  raisedBy: { id: 'user-raiser' },
  assignedTechnician: { id: 'tech-1', user: { id: 'user-tech' } },
  ...overrides,
});

// ---- Pure event → notification mapping -----------------------------------

test('created → client_admin + zone_incharge', () => {
  const n = notificationForEvent({ type: DOMAIN_EVENT.ISSUE_CREATED, issue: issue() });
  assert.deepEqual(n.audiences, [AUDIENCE.CLIENT_ADMIN, AUDIENCE.ZONE_INCHARGE]);
  assert.equal(n.data.type, 'issue_created');
  assert.equal(n.data.issueId, 'issue-1');
});

test('assigned → assigned_technician only, matches push contract', () => {
  const n = notificationForEvent({
    type: DOMAIN_EVENT.ISSUE_UPDATED,
    issue: issue({ status: 'assigned' }),
  });
  assert.deepEqual(n.audiences, [AUDIENCE.ASSIGNED_TECHNICIAN]);
  assert.equal(n.title, 'New issue assigned');
  assert.equal(n.data.type, 'issue_assigned');
});

test('resolved → raiser + zone_incharge', () => {
  const n = notificationForEvent({
    type: DOMAIN_EVENT.ISSUE_UPDATED,
    issue: issue({ status: 'resolved' }),
  });
  assert.deepEqual(n.audiences, [AUDIENCE.RAISER, AUDIENCE.ZONE_INCHARGE]);
});

test('reopened → assigned_technician', () => {
  const n = notificationForEvent({
    type: DOMAIN_EVENT.ISSUE_UPDATED,
    issue: issue({ status: 'reopened' }),
  });
  assert.deepEqual(n.audiences, [AUDIENCE.ASSIGNED_TECHNICIAN]);
});

test('no notification for statuses with no interested party', () => {
  const n = notificationForEvent({
    type: DOMAIN_EVENT.ISSUE_UPDATED,
    issue: issue({ status: 'open' }),
  });
  assert.equal(n, null);
});

// ---- Token selection + pruning (fake db + fake send) ---------------------

test('assigned dispatch selects only the technician’s tokens', async () => {
  const calls = [];
  const fakeDb = {
    deviceToken: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.userId.in, ['user-tech']); // only the technician
        return [{ token: 'tok-tech-A' }, { token: 'tok-tech-B' }];
      },
      deleteMany: async ({ where }) => {
        calls.push(['delete', where.token.in]);
        return { count: where.token.in.length };
      },
    },
  };
  const fakeSend = async (tokens, payload) => {
    calls.push(['send', tokens, payload.title]);
    return { sent: 1, invalidTokens: ['tok-tech-B'] }; // B is dead
  };

  const res = await handleIssueEvent(
    { type: DOMAIN_EVENT.ISSUE_UPDATED, issue: issue({ status: 'assigned' }) },
    { db: fakeDb, send: fakeSend }
  );

  assert.equal(res.sent, 1);
  assert.deepEqual(res.userIds, ['user-tech']);
  assert.deepEqual(calls[0], ['send', ['tok-tech-A', 'tok-tech-B'], 'New issue assigned']);
  assert.deepEqual(calls[1], ['delete', ['tok-tech-B']]); // dead token pruned
});

test('created selects zone-incharge (own zone) + client-admin tokens', async () => {
  const seen = {};
  const fakeDb = {
    zoneAssignment: {
      findMany: async ({ where }) => {
        seen.zoneIds = where.zoneId.in;
        seen.role = where.role;
        return [{ userId: 'user-incharge' }];
      },
    },
    zone: { findUnique: async () => ({ clientId: 'client-1' }) },
    user: {
      findMany: async ({ where }) => {
        seen.adminWhere = where;
        return [{ id: 'user-admin' }];
      },
    },
    deviceToken: {
      findMany: async ({ where }) => {
        seen.recipientIds = where.userId.in;
        return [{ token: 'tok-x' }];
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
  // Cascading is always on: incharge resolution expands to zone + ancestors.
  let ancestorsCalled = false;
  const ancestorsOf = async () => { ancestorsCalled = true; return [{ id: 'zone-1' }]; };

  const res = await handleIssueEvent(
    { type: DOMAIN_EVENT.ISSUE_CREATED, issue: issue() },
    { db: fakeDb, send: async () => ({ sent: 1, invalidTokens: [] }), ancestorsOf }
  );

  assert.equal(ancestorsCalled, true); // cascade always on → ancestor lookup ran
  assert.deepEqual(seen.zoneIds, ['zone-1']);
  assert.equal(seen.role, 'incharge'); // matches ZoneAssignmentRole enum literal
  assert.deepEqual(seen.adminWhere, { clientId: 'client-1', role: 'client_admin', accountStatus: 'active' });
  assert.deepEqual(res.userIds.sort(), ['user-admin', 'user-incharge']);
});

test('cascade always-on: incharge push reaches own zone AND ancestor zones', async () => {
  let ancestorsCalled = false;
  const fakeDb = {
    zoneAssignment: {
      // Return an incharge for every zone queried, so we can prove the ancestor
      // zone's incharge is included.
      findMany: async ({ where }) => where.zoneId.in.map((z) => ({ userId: `incharge-${z}` })),
    },
    zone: { findUnique: async () => ({ clientId: null }) }, // no client admins
    user: { findMany: async () => [] },
    deviceToken: { findMany: async () => [{ token: 't' }], deleteMany: async () => ({ count: 0 }) },
  };

  // resolved → RAISER + ZONE_INCHARGE.
  const res = await handleIssueEvent(
    { type: DOMAIN_EVENT.ISSUE_UPDATED, issue: issue({ status: 'resolved' }) },
    {
      db: fakeDb,
      send: async () => ({ sent: 1, invalidTokens: [] }),
      ancestorsOf: async () => { ancestorsCalled = true; return [{ id: 'zone-1' }, { id: 'zone-parent' }]; },
    }
  );

  assert.equal(ancestorsCalled, true);                     // ancestor lookup ran
  assert.ok(res.userIds.includes('incharge-zone-1'));      // own-zone incharge
  assert.ok(res.userIds.includes('incharge-zone-parent')); // ancestor incharge too
  assert.ok(res.userIds.includes('user-raiser'));
});

test('no recipients → no send', async () => {
  let sendCalled = false;
  const fakeDb = {
    deviceToken: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  };
  const res = await handleIssueEvent(
    // reopened targets the technician, but strip the technician so audience is empty
    { type: DOMAIN_EVENT.ISSUE_UPDATED, issue: issue({ status: 'reopened', assignedTechnician: null }) },
    { db: fakeDb, send: async () => { sendCalled = true; return { sent: 0, invalidTokens: [] }; } }
  );
  assert.equal(sendCalled, false);
  assert.equal(res.sent, 0);
});

console.log('push.test.mjs loaded');
