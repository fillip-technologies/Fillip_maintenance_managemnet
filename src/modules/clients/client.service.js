import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { clientScopeWhere, combine } from '../../authz/scope.js';

export const clientService = {
  async list({ page, limit, search, companyId }, scope) {
    const filters = {
      ...(companyId ? { companyId } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const where = combine(clientScopeWhere(scope), filters);
    const total = await prisma.client.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async getById(id) {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) throw ApiError.notFound('Client not found');
    return client;
  },

  async getDependents(id) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!client) throw ApiError.notFound('Client not found');

    const zones = await prisma.zone.findMany({
      where: { clientId: id },
      select: { id: true },
    });
    const zoneIds = zones.map((z) => z.id);

    const [users, technicianAssignments, devicesDeployed, openIssues] = await Promise.all([
      prisma.user.count({ where: { clientId: id } }),
      prisma.technicianAssignment.count({ where: { clientId: id } }),
      zoneIds.length
        ? prisma.device.count({ where: { zoneId: { in: zoneIds } } })
        : Promise.resolve(0),
      zoneIds.length
        ? prisma.issue.count({
            where: {
              device: { zoneId: { in: zoneIds } },
              status: { in: ['open', 'assigned', 'in_progress', 'on_hold'] },
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      client: { id: client.id, name: client.name },
      organization: { id: client.companyId, name: client.company?.name ?? '—' },
      dependents: {
        zones: zones.length,
        users,
        devicesDeployed,
        openIssues,
        technicianAssignments,
      },
    };
  },

  async create({ companyId, name, ...clientData }) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw ApiError.badRequest('Organization not found');
    return prisma.client.create({ data: { companyId, name, ...clientData } });
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.client.update({ where: { id }, data });
  },

  async exportData(id) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: { company: { select: { name: true } } },
    });
    if (!client) throw ApiError.notFound('Client not found');

    const zones = await prisma.zone.findMany({ where: { clientId: id } });
    const zoneIds = zones.map((z) => z.id);

    const [users, devices, issues] = await Promise.all([
      prisma.user.findMany({
        where: { clientId: id },
        select: { name: true, email: true, role: true, accountStatus: true, createdAt: true },
      }),
      zoneIds.length
        ? prisma.device.findMany({
            where: { zoneId: { in: zoneIds } },
            include: {
              category: { select: { name: true, code: true } },
              zone: { select: { name: true } },
            },
          })
        : [],
      zoneIds.length
        ? prisma.issue.findMany({
            where: { device: { zoneId: { in: zoneIds } } },
            include: {
              device: { select: { name: true, code: true } },
              category: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Fixly Platform';
    wb.created = new Date();

    const bold = { font: { bold: true } };
    const header = (ws, cols) => {
      ws.columns = cols;
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    };

    // Sheet 1 — Client Info
    const s1 = wb.addWorksheet('Client Info');
    s1.columns = [{ header: 'Field', key: 'field', width: 24 }, { header: 'Value', key: 'value', width: 40 }];
    s1.getRow(1).font = bold.font;
    [
      ['Client Name', client.name],
      ['Organization', client.company?.name ?? '—'],
      ['Facility Name', client.facilityName ?? '—'],
      ['Location', client.location ?? '—'],
      ['Type', client.type ?? '—'],
      ['Created At', client.createdAt.toISOString()],
    ].forEach(([field, value]) => s1.addRow({ field, value }));

    // Sheet 2 — Zones
    const s2 = wb.addWorksheet('Zones');
    header(s2, [
      { header: 'Zone Name', key: 'name', width: 28 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ]);
    zones.forEach((z) => s2.addRow({ name: z.name, status: z.status, createdAt: z.createdAt.toISOString() }));

    // Sheet 3 — Devices
    const s3 = wb.addWorksheet('Devices');
    header(s3, [
      { header: 'Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Zone', key: 'zone', width: 22 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Unit Price (₹)', key: 'unitPrice', width: 16 },
      { header: 'Purchase Date', key: 'purchaseDate', width: 18 },
      { header: 'Install Date', key: 'installDate', width: 18 },
    ]);
    devices.forEach((d) =>
      s3.addRow({
        code: d.code,
        name: d.name,
        category: d.category ? `${d.category.name} (${d.category.code})` : '—',
        zone: d.zone?.name ?? '—',
        status: d.status,
        unitPrice: d.unitPrice ?? '',
        purchaseDate: d.purchaseDate?.toISOString().slice(0, 10) ?? '',
        installDate: d.installDate?.toISOString().slice(0, 10) ?? '',
      })
    );

    // Sheet 4 — Users
    const s4 = wb.addWorksheet('Users');
    header(s4, [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Role', key: 'role', width: 18 },
      { header: 'Status', key: 'accountStatus', width: 16 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ]);
    users.forEach((u) =>
      s4.addRow({ name: u.name, email: u.email, role: u.role, accountStatus: u.accountStatus, createdAt: u.createdAt.toISOString() })
    );

    // Sheet 5 — Issues
    const s5 = wb.addWorksheet('Issues');
    header(s5, [
      { header: 'Device Code', key: 'code', width: 18 },
      { header: 'Device Name', key: 'deviceName', width: 28 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Raised At', key: 'createdAt', width: 22 },
    ]);
    issues.forEach((i) =>
      s5.addRow({
        code: i.device?.code ?? '—',
        deviceName: i.device?.name ?? '—',
        category: i.category?.name ?? '—',
        priority: i.priority,
        status: i.status,
        description: i.description ?? '',
        createdAt: i.createdAt.toISOString(),
      })
    );

    return { buffer: await wb.xlsx.writeBuffer(), clientName: client.name };
  },

  async remove(id) {
    await this.getById(id);

    // Delete all users belonging to this client first (User.clientId is SetNull,
    // so they would be orphaned rather than removed without this explicit step).
    await prisma.user.deleteMany({ where: { clientId: id } });

    // Delete the client. Prisma cascades: zones → zone_assignments, client_verticals,
    // technician_assignments. Device.zoneId becomes null (SetNull) on zone delete,
    // returning devices to org stock — the organization itself is not touched.
    await prisma.client.delete({ where: { id } });
  },
};
