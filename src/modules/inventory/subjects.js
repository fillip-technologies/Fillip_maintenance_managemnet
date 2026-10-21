import { prisma } from '../../lib/prisma.js';
import { P } from './permissions.js';

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
};
