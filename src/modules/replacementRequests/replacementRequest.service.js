import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { issueScopeWhere, combine } from '../../authz/scope.js';
import { issueService } from '../issues/issue.service.js';
import { emitReplacementEvent, DOMAIN_EVENT } from '../../realtime/events.js';

const ACTIVE = ['pending', 'approved'];

const include = {
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true } },
  issue: {
    select: {
      id: true,
      status: true,
      priority: true,
      description: true,
      deviceId: true,
      assignedTechnicianId: true,
      category: { select: { id: true, name: true } },
      device: {
        select: {
          id: true,
          name: true,
          code: true,
          zoneId: true,
          companyId: true,
          zone: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
        },
      },
    },
  },
};

const REASON_LABEL = {
  physical_damage: 'PHYSICAL_DAMAGE',
  burnt_water: 'BURNT_WATER',
  unrepairable: 'UNREPAIRABLE',
  obsolete: 'OBSOLETE',
};

function buildComment(req, extraNotes) {
  const notes = [req.notes, extraNotes].map((n) => (n ?? '').trim()).filter(Boolean).join(' ');
  const replacement =
    req.replacementChoice === 'in_stock'
      ? `Installed in-stock spare unit: ${req.spareDeviceName ?? ''} (${req.spareDeviceCode || req.spareDeviceId}).`
      : req.replacementChoice === 'new_device'
        ? 'Installed new hardware unit.'
        : 'No replacement installed; slot left vacant.';
  const label = REASON_LABEL[req.reason] ?? String(req.reason).toUpperCase();
  return `[HARDWARE DECOMMISSIONED - ${label}] ${notes ? `${notes}. ` : ''}${replacement} (Replacement approved by ${req.reviewedBy?.name ?? 'admin'}.)`;
}

// Scope is enforced through the parent issue — the same visibility rules that
// govern issues govern their replacement requests. Technicians additionally
// only ever see requests they raised themselves.
function scopeWhere(user, scope) {
  if (scope.platform) return {};
  if (user.role === 'technician') return { requestedByUserId: user.id };
  return { issue: issueScopeWhere(scope) };
}

async function loadScoped(id, user, scope) {
  const row = await prisma.replacementRequest.findFirst({
    where: combine(scopeWhere(user, scope), { id }),
    include,
  });
  if (!row) throw ApiError.notFound('Replacement request not found');
  return row;
}

export const replacementRequestService = {
  async list(query, user, scope) {
    const { page, limit, status, issueId } = query;
    const filters = {
      ...(issueId ? { issueId } : {}),
      ...(status ? { status: { in: status.split(',').map((s) => s.trim()) } } : {}),
    };
    const where = combine(scopeWhere(user, scope), filters);
    const total = await prisma.replacementRequest.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.replacementRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include,
    });
    return { items, meta };
  },

  getById(id, user, scope) {
    return loadScoped(id, user, scope);
  },

  async create(body, user, scope) {
    if (user.role !== 'technician') {
      throw ApiError.forbidden('Only technicians can request an equipment replacement');
    }
    const issue = await prisma.issue.findFirst({
      where: combine(issueScopeWhere(scope), { id: body.issueId }),
      select: { id: true, status: true, deviceId: true },
    });
    if (!issue) throw ApiError.notFound('Issue not found');
    if (['resolved', 'closed'].includes(issue.status)) {
      throw ApiError.badRequest(`Cannot request a replacement for a ${issue.status} issue`);
    }

    const existing = await prisma.replacementRequest.findFirst({
      where: { issueId: issue.id, status: { in: ACTIVE } },
      select: { id: true, status: true },
    });
    if (existing) {
      throw ApiError.conflict(
        existing.status === 'pending'
          ? 'A replacement request for this issue is already awaiting approval'
          : 'A replacement request for this issue is already approved — proceed with the replacement',
        { requestId: existing.id },
        'REPLACEMENT_REQUEST_EXISTS'
      );
    }

    let spare = null;
    if (body.replacementChoice === 'in_stock') {
      spare = await prisma.device.findUnique({
        where: { id: body.spareDeviceId },
        select: { id: true, name: true, code: true, status: true },
      });
      if (!spare) throw ApiError.badRequest('Selected spare unit does not exist');
      if (spare.status === 'retired') throw ApiError.badRequest('Selected spare unit is retired');
    }

    const created = await prisma.replacementRequest.create({
      data: {
        issueId: issue.id,
        requestedByUserId: user.id,
        reason: body.reason,
        replacementChoice: body.replacementChoice,
        spareDeviceId: spare?.id ?? null,
        spareDeviceName: spare?.name ?? body.newDeviceName ?? null,
        spareDeviceCode: spare?.code ?? null,
        notes: body.notes || null,
      },
      include,
    });
    emitReplacementEvent(DOMAIN_EVENT.REPLACEMENT_REQUESTED, created);
    return created;
  },

  async review(id, decision, { reviewNote }, user, scope) {
    if (!['super_admin', 'client_admin'].includes(user.role)) {
      throw ApiError.forbidden('Only the organization head or super admin can review replacement requests');
    }
    const row = await loadScoped(id, user, scope);
    if (row.status !== 'pending') {
      throw ApiError.conflict(`Request is already ${row.status}`, undefined, 'INVALID_STATE');
    }
    // Conditional update guards against two reviewers acting concurrently.
    const res = await prisma.replacementRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: decision,
        reviewedByUserId: user.id,
        reviewNote: reviewNote || null,
        reviewedAt: new Date(),
      },
    });
    if (res.count === 0) throw ApiError.conflict('Request was already reviewed', undefined, 'INVALID_STATE');
    const updated = await loadScoped(id, user, scope);
    emitReplacementEvent(
      decision === 'approved' ? DOMAIN_EVENT.REPLACEMENT_APPROVED : DOMAIN_EVENT.REPLACEMENT_REJECTED,
      updated
    );
    return updated;
  },

  approve(id, body, user, scope) {
    return this.review(id, 'approved', body, user, scope);
  },
  reject(id, body, user, scope) {
    return this.review(id, 'rejected', body, user, scope);
  },

  async cancel(id, user, scope) {
    if (user.role !== 'technician') throw ApiError.forbidden('Only the requesting technician can cancel');
    const row = await loadScoped(id, user, scope);
    if (row.status !== 'pending') {
      throw ApiError.conflict(`Only pending requests can be cancelled (this one is ${row.status})`, undefined, 'INVALID_STATE');
    }
    await prisma.replacementRequest.update({ where: { id }, data: { status: 'cancelled' } });
    return loadScoped(id, user, scope);
  },

  /** Technician carries out an APPROVED replacement: resolves the issue. */
  async complete(id, { latitude = null, longitude = null, notes = null }, user, scope) {
    if (user.role !== 'technician') {
      throw ApiError.forbidden('Only the requesting technician can complete the replacement');
    }
    const row = await loadScoped(id, user, scope);
    if (row.status !== 'approved') {
      throw ApiError.badRequest(
        row.status === 'pending'
          ? 'This replacement is still awaiting approval'
          : `Replacement request is ${row.status}`,
        undefined,
        'REPLACEMENT_NOT_APPROVED'
      );
    }
    if (['resolved', 'closed'].includes(row.issue.status)) {
      throw ApiError.conflict(`Issue is already ${row.issue.status}`);
    }

    // Atomically claim the request so a double-tap can't resolve twice.
    const claim = await prisma.replacementRequest.updateMany({
      where: { id, status: 'approved' },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (claim.count === 0) throw ApiError.conflict('Replacement was already completed', undefined, 'INVALID_STATE');

    try {
      await issueService.transition(
        row.issueId,
        {
          toStatus: 'resolved',
          notes: buildComment(row, notes),
          changedByUserId: user.id,
          latitude,
          longitude,
        },
        user,
        scope
      );
    } catch (err) {
      await prisma.replacementRequest
        .update({ where: { id }, data: { status: 'approved', completedAt: null } })
        .catch(() => {});
      throw err;
    }
    const updated = await loadScoped(id, user, scope);
    emitReplacementEvent(DOMAIN_EVENT.REPLACEMENT_COMPLETED, updated);
    return updated;
  },
};
