import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { zoneController } from './zone.controller.js';
import {
  listZonesSchema,
  getZoneSchema,
  createZoneSchema,
  updateZoneSchema,
  setZoneStatusSchema,
  descendantsSchema,
  assignSchema,
  unassignSchema,
  deleteZoneSchema,
  activitySchema,
} from './zone.validation.js';

export const zoneRouter = Router();

const canCreate = requireRole('super_admin', 'client_admin');
const canDelete = requireRole('super_admin');

zoneRouter.get('/', validate(listZonesSchema), zoneController.list);
zoneRouter.post('/', canCreate, validate(createZoneSchema), zoneController.create);
zoneRouter.get('/:id', validate(getZoneSchema), zoneController.get);
zoneRouter.get('/:id/descendants', validate(descendantsSchema), zoneController.descendants);
zoneRouter.patch('/:id', validate(updateZoneSchema), zoneController.update);
// No hard delete — archive a zone via PATCH /:id/status → inactive so its
// devices, issues, and history are preserved (spec §3.1).
zoneRouter.patch('/:id/status', validate(setZoneStatusSchema), zoneController.setStatus);
zoneRouter.delete('/:id', canDelete, validate(deleteZoneSchema), zoneController.remove);

// Zone assignments (incharge / staff).
zoneRouter.get('/:id/activity', validate(activitySchema), zoneController.activity);
zoneRouter.get('/:id/assignments', validate(getZoneSchema), zoneController.listAssignments);
zoneRouter.post('/:id/assign', validate(assignSchema), zoneController.assign);
zoneRouter.delete('/:id/assignments/:assignmentId', validate(unassignSchema), zoneController.unassign);
