import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
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
} from './zone.validation.js';

export const zoneRouter = Router();

zoneRouter.get('/', validate(listZonesSchema), zoneController.list);
zoneRouter.post('/', validate(createZoneSchema), zoneController.create);
zoneRouter.get('/:id', validate(getZoneSchema), zoneController.get);
zoneRouter.get('/:id/descendants', validate(descendantsSchema), zoneController.descendants);
zoneRouter.patch('/:id', validate(updateZoneSchema), zoneController.update);
// No hard delete — archive a zone via PATCH /:id/status → inactive so its
// devices, issues, and history are preserved (spec §3.1).
zoneRouter.patch('/:id/status', validate(setZoneStatusSchema), zoneController.setStatus);

// Zone assignments (incharge / staff).
zoneRouter.get('/:id/assignments', validate(getZoneSchema), zoneController.listAssignments);
zoneRouter.post('/:id/assign', validate(assignSchema), zoneController.assign);
zoneRouter.delete('/:id/assignments/:assignmentId', validate(unassignSchema), zoneController.unassign);
