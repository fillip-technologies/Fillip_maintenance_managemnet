import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { reserveCodes } from '../productCategories/productCategory.service.js';

/**
 * Bulk unit ("Product") import from Excel/CSV.
 *
 * Flow: download template → upload → dry-run validate (no writes) → commit.
 * Category is matched by NAME or CODE against the global category list and is
 * REQUIRED. Zone is optional (a unit with no zone is imported IN STOCK). Codes
 * are minted in one batched reservation per category so a large import doesn't
 * serialize on per-row locks. Company scope mirrors single create: a client_admin
 * is locked to their own org; a super_admin must supply/target one company.
 */

const COLUMNS = [
  { header: 'name', width: 34, required: true },
  { header: 'category', width: 26, required: true, note: 'category name or code (e.g. CAM)' },
  { header: 'quantity', width: 12, required: false, note: 'how many identical units (default 1)' },
  { header: 'zone', width: 22, required: false, note: 'zone name — leave blank for in-stock' },
  { header: 'unitPrice', width: 14, required: false },
  { header: 'purchaseDate', width: 16, required: false, note: 'YYYY-MM-DD' },
  { header: 'location', width: 22, required: false },
];

const MAX_ROWS = 5000;

/** Build the .xlsx import template (headers + one example row). */
export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Units');
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.addRow({ name: '4K Dome Camera', category: 'CAM', quantity: 5, zone: '', unitPrice: 38500, purchaseDate: '2026-07-15', location: 'Lobby' });
  // A note row describing optional fields (visually greyed).
  const note = ws.addRow({ name: '(required)', category: '(name or code, required)', quantity: '(optional, default 1)', zone: '(optional; blank = in stock)', unitPrice: '(optional)', purchaseDate: '(optional YYYY-MM-DD)', location: '(optional)' });
  note.font = { italic: true, color: { argb: 'FF999999' } };
  return wb.xlsx.writeBuffer();
}

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  zone: z.string().trim().optional(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  purchaseDate: z.coerce.date().optional(),
  location: z.string().trim().max(200).optional(),
});

function cellStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.text) return String(v.text).trim(); // rich text / hyperlink
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim(); // formula
  return String(v).trim();
}

/** Parse an uploaded workbook buffer into raw row objects (header-keyed). */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest('The file has no worksheet');

  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = cellStr(cell.value).toLowerCase(); });

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let empty = true;
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (!key) return;
      const val = cellStr(cell.value);
      if (val !== '') empty = false;
      obj[key] = val;
    });
    if (empty) continue; // skip blank rows
    // Skip the italic "(optional...)" note row from our own template.
    if (/^\(.*\)$/.test(obj.name ?? '')) continue;
    rows.push({ _row: r, ...obj });
  }
  if (rows.length > MAX_ROWS) throw ApiError.badRequest(`Too many rows (${rows.length}); max ${MAX_ROWS} per import`);
  return rows;
}

/**
 * Validate every row against the caller's org + the global categories/zones.
 * Returns { valid: [{ _row, data, categoryId, zoneId }], errors: [{ row, field, message }] }.
 * No writes.
 */
async function validateRows(rawRows, { companyId, scopeZoneIds }) {
  const categories = await prisma.productCategory.findMany({ select: { id: true, name: true, code: true } });
  const catByKey = new Map();
  for (const c of categories) {
    catByKey.set(c.name.toLowerCase(), c.id);
    catByKey.set(c.code.toLowerCase(), c.id);
  }
  // Zones the units may land in — restricted to the caller's company.
  const zones = await prisma.zone.findMany({
    where: { client: { companyId } },
    select: { id: true, name: true },
  });
  const zoneByName = new Map(zones.map((z) => [z.name.toLowerCase(), z.id]));

  const valid = [];
  const errors = [];
  for (const raw of rawRows) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: raw._row, field: issue.path.join('.') || 'row', message: issue.message });
      }
      continue;
    }
    const d = parsed.data;
    const categoryId = catByKey.get(d.category.toLowerCase());
    if (!categoryId) {
      errors.push({ row: raw._row, field: 'category', message: `Unknown category "${d.category}"` });
      continue;
    }
    let zoneId = null;
    if (d.zone) {
      // Zones are already restricted to the caller's company (query above), so a
      // resolved zone is in-org by construction. Zone-scoped callers can't reach
      // this path (import is admin-only), so no further scope gate is needed.
      zoneId = zoneByName.get(d.zone.toLowerCase()) ?? null;
      if (!zoneId) { errors.push({ row: raw._row, field: 'zone', message: `Unknown zone "${d.zone}" in your organization` }); continue; }
    }
    valid.push({ _row: raw._row, data: d, categoryId, zoneId });
  }
  return { valid, errors };
}

export const deviceImportService = {
  buildTemplate,

  /** Resolve the company the caller may import into (mirrors single create). */
  async resolveCompany(user, requestedCompanyId) {
    if (user.role === 'client_admin') {
      if (!user.companyId) throw ApiError.forbidden('Your account is not attached to an organization');
      if (requestedCompanyId && requestedCompanyId !== user.companyId) {
        throw ApiError.forbidden('You can only import into your own organization');
      }
      return user.companyId;
    }
    if (!requestedCompanyId) throw ApiError.badRequest('Select an organization (companyId) for the import', undefined, 'COMPANY_REQUIRED');
    const c = await prisma.company.findUnique({ where: { id: requestedCompanyId }, select: { id: true } });
    if (!c) throw ApiError.badRequest('Organization does not exist');
    return requestedCompanyId;
  },

  /** Dry-run: parse + validate, return preview. Never writes. */
  async dryRun(buffer, user, scope, requestedCompanyId) {
    const companyId = await this.resolveCompany(user, requestedCompanyId);
    const raw = await parseWorkbook(buffer);
    const scopeZoneIds = scope?.platform ? null : scope?.zoneIds ?? [];
    const { valid, errors } = await validateRows(raw, { companyId, scopeZoneIds });
    const totalUnits = valid.reduce((n, v) => n + v.data.quantity, 0);
    return {
      summary: { rows: raw.length, validRows: valid.length, errorRows: errors.length, unitsToCreate: totalUnits },
      preview: valid.map((v) => ({ row: v._row, name: v.data.name, category: v.data.category, quantity: v.data.quantity, zone: v.data.zone || null })),
      errors,
    };
  },

  /** Commit: create units for all valid rows, mint codes in batched reservations. */
  async commit(buffer, user, scope, requestedCompanyId) {
    const companyId = await this.resolveCompany(user, requestedCompanyId);
    const raw = await parseWorkbook(buffer);
    const scopeZoneIds = scope?.platform ? null : scope?.zoneIds ?? [];
    const { valid, errors } = await validateRows(raw, { companyId, scopeZoneIds });
    if (valid.length === 0) {
      return { created: 0, skipped: errors.length, errors };
    }

    // Group valid rows by category so codes are reserved in one batch per category.
    const byCategory = new Map();
    for (const v of valid) {
      const arr = byCategory.get(v.categoryId) ?? [];
      arr.push(v);
      byCategory.set(v.categoryId, arr);
    }

    let created = 0;
    await prisma.$transaction(async (tx) => {
      for (const [categoryId, rowsForCat] of byCategory) {
        const count = rowsForCat.reduce((n, v) => n + v.data.quantity, 0);
        const { codes } = await reserveCodes(tx, categoryId, count);
        let ci = 0;
        const data = [];
        for (const v of rowsForCat) {
          for (let q = 0; q < v.data.quantity; q++) {
            data.push({
              code: codes[ci++],
              name: v.data.name,
              categoryId,
              companyId,
              zoneId: v.zoneId,
              unitPrice: v.data.unitPrice ?? null,
              purchaseDate: v.data.purchaseDate ?? null,
              location: v.data.location ?? null,
              addedById: user.id,
              isManualEntry: true,
            });
          }
        }
        await tx.device.createMany({ data });
        created += data.length;
      }
    }, { maxWait: 15_000, timeout: 60_000 });

    return { created, skipped: errors.length, errors };
  },
};
