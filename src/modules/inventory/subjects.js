import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { P } from './permissions.js';
import { issueWhere } from './services/issues.js';

/**
 * Inventory records FBOS Documents can attach files to (`inventory.<entity>`).
 * Each entry: the codes for reading and attaching, the code whose scope decides
 * which records the caller sees, a scoped lookup and a human label.
 * Documents needs `"inventory": "<base>/api/inventory/v1"` in SUBJECT_SERVICES.
 */
const deviceScoped = (access) => ({ AND: [access.deviceWhere(), { deletedAt: null }] });

export const SUBJECTS = {
  'inventory.device': {
    label: 'device',
    readCode: P.DEVICE_READ,
    attachCode: P.DEVICE_WRITE,
    scopeCode: P.DEVICE_READ,
    find: (access, id) => prisma.device.findFirst({ where: { AND: [deviceScoped(access), { id }] }, select: { code: true, name: true } }),
    labelOf: (d) => `${d.code ?? ''} ${d.name}`.trim(),
  },
  'inventory.issue': {
    label: 'issue',
    readCode: P.ISSUE_READ,
    attachCode: P.ISSUE_WRITE,
    scopeCode: P.ISSUE_READ,
    find: (access, id) => prisma.issue.findFirst({ where: { AND: [issueWhere(access), { id }] }, select: { issueNumber: true } }),
    labelOf: (i) => i.issueNumber ?? 'Issue',
  },
  // Operator records: no customer scope, the permission decides.
  'inventory.purchase_order': operatorSubject('purchase order', P.PURCHASE_ORDER_READ, P.PURCHASE_ORDER_WRITE, (id) => prisma.purchaseOrder.findFirst({ where: { id, ...org() }, select: { poNumber: true } }), (r) => r.poNumber),
  'inventory.goods_receipt': operatorSubject('goods receipt', P.PURCHASE_ORDER_READ, P.GOODS_RECEIPT_WRITE, (id) => prisma.goodsReceipt.findFirst({ where: { id, ...org() }, select: { grnNumber: true } }), (r) => r.grnNumber),
  'inventory.repair_order': operatorSubject('repair order', P.REPAIR_READ, P.REPAIR_WRITE, (id) => prisma.repairOrder.findFirst({ where: { id, ...org() }, select: { repairNumber: true } }), (r) => r.repairNumber),
  'inventory.disposal': operatorSubject('disposal', P.DISPOSAL_READ, P.DISPOSAL_WRITE, (id) => prisma.deviceDisposal.findFirst({ where: { id, ...org() }, select: { device: { select: { code: true } } } }), (r) => `Disposal of ${r.device.code}`),
};

function org() {
  return env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {};
}

function operatorSubject(label, readCode, attachCode, findById, labelOf) {
  return { label, readCode, attachCode, scopeCode: readCode, find: (_access, id) => findById(id), labelOf };
}
