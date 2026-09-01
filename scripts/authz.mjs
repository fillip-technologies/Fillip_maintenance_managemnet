// Negative authorization tests — prove tenant/zone isolation actually denies.
// Green positives prove nothing here; every check below asserts a DENIAL.
const BASE = 'http://localhost:3000/api/v1';
let pass = 0;
let fail = 0;
const uniq = Date.now();

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, json };
}

const login = async (email, password = 'Password123!') =>
  (await req('POST', '/auth/login', { body: { email, password } })).json?.data?.accessToken;

async function main() {
  const su = await login('super@example.com');
  const admin1 = await login('priya@cityzoo.com'); // tenant-1 client_admin

  // --- Tenant-1 resource ids to probe from tenant-2 ---
  const t1clients = await req('GET', '/clients', { token: su });
  const client1 = t1clients.json.data.items.find((c) => c.name === 'City Zoo');
  const t1devices = await req('GET', '/devices', { token: admin1 });
  const device1 = t1devices.json.data.items[0];
  const t1cats = await req('GET', `/issue-categories?hardwareTypeId=${device1.hardwareTypeId}`, { token: su });
  const cat1 = t1cats.json.data.items[0];
  const issue1 = (await req('POST', '/issues', {
    token: su,
    body: { deviceId: device1.id, categoryId: cat1.id, priority: 'low', description: 'authz probe' },
  })).json.data;

  // --- Build a completely separate tenant-2 ---
  console.log('\n== Provision tenant-2 ==');
  const company2 = (await req('POST', '/companies', { token: su, body: { name: `T2 Co ${uniq}` } })).json.data;
  const client2 = (await req('POST', '/clients', { token: su, body: { companyId: company2.id, name: `T2 Client ${uniq}` } })).json.data;
  const zone2 = (await req('POST', '/zones', { token: su, body: { clientId: client2.id, name: 'T2 Zone' } })).json.data;
  const hw2 = (await req('GET', '/hardware-types', { token: su })).json.data.items[0];
  const device2 = (await req('POST', '/devices', { token: su, body: { zoneId: zone2.id, hardwareTypeId: hw2.id, name: 'T2 Cam' } })).json.data;
  const admin2Email = `t2admin_${uniq}@x.com`;
  await req('POST', '/users', { token: su, body: { name: 'T2 Admin', email: admin2Email, role: 'client_admin', clientId: client2.id, password: 'Password123!' } });
  const admin2 = await login(admin2Email);
  check('tenant-2 provisioned + client_admin2 logs in', !!admin2 && !!device2);

  // --- Cross-tenant DENIALS (the whole point) ---
  console.log('\n== Cross-tenant isolation (client_admin2 vs tenant-1) ==');
  const seesDevices = await req('GET', '/devices', { token: admin2 });
  const leaks = seesDevices.json.data.items.filter((d) => d.zone?.clientId === client1.id);
  check('device list excludes tenant-1 devices', leaks.length === 0, `leaked ${leaks.length}`);
  check('device list only shows tenant-2', seesDevices.json.data.items.every((d) => d.zone?.clientId === client2.id));

  const getDev1 = await req('GET', `/devices/${device1.id}`, { token: admin2 });
  check('GET tenant-1 device by id → 404', getDev1.status === 404, `got ${getDev1.status}`);

  const getIssue1 = await req('GET', `/issues/${issue1.id}`, { token: admin2 });
  check('GET tenant-1 issue by id → 404', getIssue1.status === 404, `got ${getIssue1.status}`);

  const mutateIssue1 = await req('PATCH', `/issues/${issue1.id}/status`, { token: admin2, body: { status: 'assigned' } });
  check('PATCH tenant-1 issue → 404 (no cross-tenant state drive)', mutateIssue1.status === 404, `got ${mutateIssue1.status}`);

  const raiseOnDev1 = await req('POST', '/issues', { token: admin2, body: { deviceId: device1.id, categoryId: cat1.id, priority: 'low', description: 'x' } });
  check('raise issue on tenant-1 device → 403', raiseOnDev1.status === 403, `got ${raiseOnDev1.status}`);

  const t1zones = await req('GET', `/zones?clientId=${client1.id}`, { token: admin2 });
  check('list tenant-1 zones → empty', (t1zones.json.data.items ?? []).length === 0);

  console.log('\n== Dashboard authorization ==');
  const platform = await req('GET', '/dashboard/summary?scope=platform', { token: admin2 });
  check('client_admin2 dashboard scope=platform → 403', platform.status === 403, `got ${platform.status}`);
  const otherClient = await req('GET', `/dashboard/summary?scope=client&id=${client1.id}`, { token: admin2 });
  check('client_admin2 dashboard of tenant-1 client → 403', otherClient.status === 403, `got ${otherClient.status}`);
  const ownClient = await req('GET', `/dashboard/summary?scope=client&id=${client2.id}`, { token: admin2 });
  check('client_admin2 dashboard of own client → 200', ownClient.status === 200, `got ${ownClient.status}`);

  // --- Technician issue visibility: assigned-to-me OR unassigned-in-coverage ---
  console.log('\n== Technician issue visibility ==');
  const amit = await login('amit@example.com'); // seeded: covers City Zoo client-wide
  const techList = (await req('GET', '/technicians', { token: su })).json.data.items;
  const amitTech = techList.find((t) => t.user?.name === 'Amit Shah');
  const otherTech = techList.find((t) => t.user?.name !== 'Amit Shah');

  const mkIssue = async () =>
    (await req('POST', '/issues', {
      token: su,
      body: { deviceId: device1.id, categoryId: cat1.id, priority: 'high', description: 'tech-vis probe' },
    })).json.data;
  const openIssue = await mkIssue(); // unassigned, in amit's coverage
  const mineIssue = await mkIssue();
  await req('PATCH', `/issues/${mineIssue.id}/assign`, { token: su, body: { technicianId: amitTech.id } });
  const otherIssue = await mkIssue();
  await req('PATCH', `/issues/${otherIssue.id}/assign`, { token: su, body: { technicianId: otherTech.id } });

  const amitIssues = (await req('GET', '/issues?limit=100', { token: amit })).json.data.items;
  const amitIds = new Set(amitIssues.map((i) => i.id));
  check('technician sees UNASSIGNED issue in coverage', amitIds.has(openIssue.id));
  check('technician sees issue ASSIGNED to them', amitIds.has(mineIssue.id));
  check('technician does NOT see issue assigned to another technician', !amitIds.has(otherIssue.id), `leaked ${otherIssue.id}`);

  // --- Intra-client zone isolation (same client, different zones) ---
  console.log('\n== Intra-client zone isolation (zone_staff) ==');
  const zoneX = (await req('POST', '/zones', { token: admin1, body: { clientId: client1.id, name: `X ${uniq}` } })).json.data;
  const zoneY = (await req('POST', '/zones', { token: admin1, body: { clientId: client1.id, name: `Y ${uniq}` } })).json.data;
  const hw1 = (await req('GET', '/hardware-types', { token: admin1 })).json.data.items[0];
  const devY = (await req('POST', '/devices', { token: admin1, body: { zoneId: zoneY.id, hardwareTypeId: hw1.id, name: `DevY ${uniq}` } })).json.data;
  const staffEmail = `staffx_${uniq}@x.com`;
  await req('POST', '/users', { token: admin1, body: { name: 'Staff X', email: staffEmail, role: 'zone_staff', clientId: client1.id, password: 'Password123!' } });
  const staffUser = (await req('GET', `/users?search=${encodeURIComponent(staffEmail)}`, { token: admin1 })).json.data.items[0];
  // Assign staff to zone X only.
  await req('POST', `/zones/${zoneX.id}/assign`, { token: admin1, body: { userId: staffUser.id, role: 'staff' } });
  const staff = await login(staffEmail);

  const staffDevices = await req('GET', '/devices', { token: staff });
  const staffSeesY = staffDevices.json.data.items.some((d) => d.id === devY.id);
  check('zone_staff (zone X) cannot see zone Y device in list', !staffSeesY);
  const staffGetY = await req('GET', `/devices/${devY.id}`, { token: staff });
  check('zone_staff GET sibling-zone device by id → 404', staffGetY.status === 404, `got ${staffGetY.status}`);
  const staffLogY = await req('POST', '/daily-logs', { token: staff, body: { deviceId: devY.id, status: 'working' } });
  check('zone_staff log on sibling-zone device → 403', staffLogY.status === 403, `got ${staffLogY.status}`);

  // --- Cascade: staff on a PARENT zone sees devices in its CHILD zones ---
  console.log('\n== Cascading visibility (zone_staff → sub-zones) ==');
  const childZone = (await req('POST', '/zones', { token: admin1, body: { clientId: client1.id, name: `X-Child ${uniq}`, parentZoneId: zoneX.id } })).json.data;
  const devChild = (await req('POST', '/devices', { token: admin1, body: { zoneId: childZone.id, hardwareTypeId: hw1.id, name: `DevXChild ${uniq}` } })).json.data;
  const staffAfter = await req('GET', '/devices', { token: staff });
  check('zone_staff (parent zone X) SEES child-zone device (cascade)', staffAfter.json.data.items.some((d) => d.id === devChild.id));
  const staffGetChild = await req('GET', `/devices/${devChild.id}`, { token: staff });
  check('zone_staff GET child-zone device by id → 200 (cascade)', staffGetChild.status === 200, `got ${staffGetChild.status}`);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
