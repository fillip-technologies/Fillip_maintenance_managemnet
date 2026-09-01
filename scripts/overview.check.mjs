// Standalone check for GET /dashboard/overview (super_admin platform overview).
// Independent of smoke.mjs (whose seeded client_admin creds can drift): this
// only relies on super@example.com (200) and a non-super account (403).
// Run against a live server:  node scripts/overview.check.mjs
const BASE = 'http://localhost:3000/api/v1';
let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 */
  }
  return { status: res.status, json };
}

const login = (email) => req('POST', '/auth/login', { body: { email, password: 'Password123!' } });

async function main() {
  console.log('\n== Super admin platform overview ==');
  const superLogin = await login('super@example.com');
  check('super_admin login 200', superLogin.status === 200, JSON.stringify(superLogin.json));
  const superToken = superLogin.json?.data?.accessToken;

  const overview = await req('GET', '/dashboard/overview', { token: superToken });
  const d = overview.json?.data;
  check('overview 200 for super_admin', overview.status === 200, JSON.stringify(overview.json));

  // Shape — every field the frontend components read.
  check('tenancy counts present', typeof d?.tenancy?.companies === 'number' && typeof d?.tenancy?.technicians === 'number');
  check('device fleet present', typeof d?.devices?.total === 'number' && typeof d?.devices?.faulty === 'number' && typeof d?.devices?.missingTodayLog === 'number');
  check('byHardwareType is an array', Array.isArray(d?.byHardwareType));
  check('issues.byStatus has all 7 states',
    d?.issues?.byStatus && ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'reopened'].every((s) => typeof d.issues.byStatus[s] === 'number'));
  check('issues.byPriority present', typeof d?.issues?.byPriority?.critical === 'number');
  check('today counters present', typeof d?.issues?.createdToday === 'number' && typeof d?.issues?.resolvedToday === 'number');
  check('criticalAlerts is an array', Array.isArray(d?.criticalAlerts));
  check('technicians.top is an array + summary', Array.isArray(d?.technicians?.top) && typeof d?.technicians?.busy === 'number');
  check('facilities is an array', Array.isArray(d?.facilities));
  check('recentActivity is an array', Array.isArray(d?.recentActivity));

  // Internal consistency — byStatus sums to issues.total.
  if (d?.issues?.byStatus) {
    const sum = Object.values(d.issues.byStatus).reduce((a, b) => a + b, 0);
    check('byStatus sums to issues.total', sum === d.issues.total, `sum=${sum} total=${d.issues.total}`);
  }

  console.log('\n== Guard: non-super_admin is denied ==');
  const other = await login('ravi@cityzoo.com'); // zone_incharge
  const otherToken = other.json?.data?.accessToken;
  check('non-super login 200', other.status === 200, JSON.stringify(other.json));
  const denied = await req('GET', '/dashboard/overview', { token: otherToken });
  check('overview 403 for non-super_admin', denied.status === 403, `got ${denied.status}`);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
