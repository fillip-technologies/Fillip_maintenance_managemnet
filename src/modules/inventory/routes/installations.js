import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate, ifMatchVersion } from '../http/request.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';
import { installDevice, removeInstallation } from '../services/installations.js';

/** Putting devices into zones and taking them out (technicians and site staff). */
export const installationsRouter = Router();

installationsRouter.post(
  '/installations',
  requirePermission(P.DEVICE_WRITE),
  validate(z.object({
    body: z.object({
      device_id: z.string().uuid(),
      zone_id: z.string().uuid(),
      position_label: z.string().trim().max(200).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      installed_by_technician_id: z.string().uuid().optional(),
      installation_type: z.enum(['new_install', 'replacement', 'reinstall_after_repair', 'relocation']).optional(),
      replaces_installation_id: z.string().uuid().optional(),
      work_unit_id: z.string().uuid().optional(),
      task_id: z.string().uuid().optional(),
      photos: z.array(z.object({ document_id: z.string().uuid() })).max(20).optional(),
    }),
  })),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => {
    const inst = await installDevice(req.access, req.actor, req.input.body, ifMatchVersion(req));
    res.status(201).json(wire.installation(inst));
  }),
);

installationsRouter.post(
  '/installations/:id/remove',
  requirePermission(P.DEVICE_WRITE),
  validate(z.object({ params: z.object({ id: z.string().uuid() }), body: z.object({ reason: z.string().trim().min(1).max(255) }) })),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => res.json(wire.installation(await removeInstallation(req.access, req.actor, req.params.id, req.input.body)))),
);
