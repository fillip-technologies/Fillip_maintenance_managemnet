// End-to-end smoke test against a running server + live DB.
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

const iso = (offsetDays) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log('\n== Auth ==');
  const login = await req('POST', '/auth/login', {
    body: { email: 'priya@cityzoo.com', password: 'Password123!' },
  });
  check('client_admin login 200', login.status === 200, JSON.stringify(login.json));
  const adminToken = login.json?.data?.accessToken;
  const clientId = login.json?.data?.user?.clientId;
  check('login returns accessToken', !!adminToken);

  const noAuth = await req('GET', '/issues');
  check('GET /issues without token → 401', noAuth.status === 401, `got ${noAuth.status}`);

  const inchargeLogin = await req('POST', '/auth/login', {
    body: { email: 'ravi@cityzoo.com', password: 'Password123!' },
  });
  const inchargeToken = inchargeLogin.json?.data?.accessToken;
  const techLogin = await req('POST', '/auth/login', {
    body: { email: 'amit@example.com', password: 'Password123!' },
  });
  const techToken = techLogin.json?.data?.accessToken;
  check('technician login has technicianId claim (via scope test later)', !!techToken);

  console.log('\n== Privilege escalation guard ==');
  const escalate = await req('POST', '/users', {
    token: inchargeToken,
    body: { name: 'Hacker', email: 'hacker@x.com', role: 'super_admin', password: 'Password123!' },
  });
  check('zone_incharge POST /users → 403', escalate.status === 403, `got ${escalate.status}`);

  console.log('\n== Setup: fresh device (idempotent), technician, category ==');
  // Find the deepest seeded zone so the device sits several levels down.
  const roots = await req('GET', `/zones?clientId=${clientId}&topLevel=true`, { token: adminToken });
  const root = roots.json?.data?.items?.[0];
  const subtree = await req('GET', `/zones/${root.id}/descendants`, { token: adminToken });
  const leaf = subtree.json?.data?.reduce((a, b) => (b.depth > a.depth ? b : a));

  const hwTypes = await req('GET', '/hardware-types', { token: adminToken });
  const hwType = hwTypes.json?.data?.items?.[0];
  const cats = await req('GET', `/issue-categories?hardwareTypeId=${hwType.id}`, { token: adminToken });
  const category = cats.json?.data?.items?.find((c) => c.name === 'no power');
  check('issue-categories lookup by hardwareType', !!category);

  const created = await req('POST', '/devices', {
    token: adminToken,
    body: { zoneId: leaf.id, hardwareTypeId: hwType.id, name: `SmokeCam ${Date.now()}`, location: 'test' },
  });
  const device = created.json?.data;
  check('create device → 201 provisioned', created.status === 201 && device?.status === 'provisioned', JSON.stringify(created.json));
  const activated = await req('PATCH', `/devices/${device.id}/status`, { token: adminToken, body: { status: 'active' } });
  check('provisioned → active', activated.json?.data?.status === 'active', JSON.stringify(activated.json));

  const techs = await req('GET', '/technicians', { token: adminToken });
  const technician = techs.json?.data?.items?.[0];
  check('technician list', !!technician);

  console.log('\n== Issue lifecycle ==');
  const raise = await req('POST', '/issues', {
    token: inchargeToken,
    body: { deviceId: device.id, categoryId: category.id, priority: 'high', description: 'Feed went dark' },
  });
  check('raise issue → 201 open', raise.status === 201 && raise.json?.data?.status === 'open', JSON.stringify(raise.json));
  const issueId = raise.json?.data?.id;

  const dev2 = await req('GET', `/devices/${device.id}`, { token: adminToken });
  check('device → under_maintenance after raise', dev2.json?.data?.status === 'under_maintenance', dev2.json?.data?.status);

  const badJump = await req('PATCH', `/issues/${issueId}/status`, { token: techToken, body: { status: 'closed' } });
  check('illegal open→closed → 400 INVALID_TRANSITION', badJump.status === 400 && badJump.json?.code === 'INVALID_TRANSITION', JSON.stringify(badJump.json));

  const assign = await req('PATCH', `/issues/${issueId}/assign`, { token: adminToken, body: { technicianId: technician.id } });
  check('assign technician → assigned', assign.json?.data?.status === 'assigned', JSON.stringify(assign.json));

  const scoped = await req('GET', '/issues?scope=technician', { token: techToken });
  check('scope=technician returns the assigned issue', scoped.json?.data?.items?.some((i) => i.id === issueId), JSON.stringify(scoped.json?.data?.items?.length));

  const prog = await req('PATCH', `/issues/${issueId}/status`, { token: techToken, body: { status: 'in_progress' } });
  check('technician → in_progress', prog.json?.data?.status === 'in_progress');
  const resolved = await req('PATCH', `/issues/${issueId}/status`, { token: techToken, body: { status: 'resolved' } });
  check('technician → resolved', resolved.json?.data?.status === 'resolved', JSON.stringify(resolved.json));
  const closed = await req('PATCH', `/issues/${issueId}/status`, { token: adminToken, body: { status: 'closed' } });
  check('client_admin → closed', closed.json?.data?.status === 'closed', JSON.stringify(closed.json));

  const dev3 = await req('GET', `/devices/${device.id}`, { token: adminToken });
  check('device → active after close', dev3.json?.data?.status === 'active', dev3.json?.data?.status);

  const history = await req('GET', `/issues/${issueId}/history`, { token: adminToken });
  check('history has 5 rows (open→assigned→in_progress→resolved→closed)', history.json?.data?.length === 5, `got ${history.json?.data?.length}`);

  console.log('\n== Daily logs + faulty trend ==');
  for (const off of [-2, -1, 0]) {
    await req('POST', '/daily-logs', {
      token: inchargeToken,
      body: { deviceId: device.id, status: 'not_working', logDate: iso(off), notes: `day ${off}` },
    });
  }
  const dev4 = await req('GET', `/devices/${device.id}`, { token: adminToken });
  check('3× not_working → device faulty', dev4.json?.data?.status === 'faulty', dev4.json?.data?.status);

  const dup = await req('POST', '/daily-logs', {
    token: inchargeToken,
    body: { deviceId: device.id, status: 'working', logDate: iso(0) },
  });
  check('duplicate same-day log → 409 ALREADY_LOGGED_TODAY', dup.status === 409 && dup.json?.code === 'ALREADY_LOGGED_TODAY', JSON.stringify(dup.json));

  console.log('\n== Zone tree ==');
  check('descendants returns 3-level subtree', subtree.json?.data?.length === 3, `got ${subtree.json?.data?.length}`);

  console.log('\n== Dashboard ==');
  const dash = await req('GET', `/dashboard/summary?scope=zone&id=${root.id}&includeSubzones=true`, { token: adminToken });
  check('dashboard summary returns counts', typeof dash.json?.data?.totalDevices === 'number', JSON.stringify(dash.json));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
