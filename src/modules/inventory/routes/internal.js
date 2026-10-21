import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { authenticateActor, requireInternalCaller } from '../auth/middleware.js';
import { accessFor } from '../auth/access.js';
import { handle, validate } from '../http/request.js';
import { InventoryError, notFound } from '../http/errors.js';
import { SUBJECTS } from '../subjects.js';

/**
 * Service-to-service routes. FBOS Documents keeps no access rules of its own:
 * before a file is attached to or read from an inventory record it asks here
 * (integration plan §5.7). 200 → `{ organization_id, label }`; a record outside
 * the caller's scope or organization is 404, so ids cannot be probed.
 */
export const internalRouter = Router();

internalRouter.get(
  '/internal/subject-access/:type/:id',
  requireInternalCaller,
  authenticateActor,
  validate(
    z.object({
      params: z.object({ type: z.string(), id: z.string().uuid() }),
      query: z.object({ action: z.enum(['read', 'attach']).default('read') }),
    }),
  ),
  handle(async (req, res) => {
    const subject = SUBJECTS[req.params.type];
    if (!subject) throw notFound('subject type', { subject_type: req.params.type });
    const code = req.input.query.action === 'attach' ? subject.attachCode : subject.readCode;
    if (!req.actor.has(code)) {
      throw new InventoryError(403, 'PERMISSION_DENIED', `You need the '${code}' permission to do this`, {
        meta: { required_permission: code },
      });
    }
    const access = await accessFor(req.actor, subject.scopeCode ?? code);
    const record = await subject.find(access, req.params.id);
    if (!record) throw notFound(subject.label);
    res.json({ organization_id: env.FBOS_ORGANIZATION_ID ?? req.actor.organizationId, label: subject.labelOf(record) });
  }),
);
