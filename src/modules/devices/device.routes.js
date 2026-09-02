import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { deviceController } from './device.controller.js';
import {
  listDevicesSchema,
  getDeviceSchema,
  createDeviceSchema,
  deployDeviceSchema,
  updateDeviceSchema,
  setDeviceStatusSchema,
} from './device.validation.js';

export const deviceRouter = Router();

// Managing the unit catalogue is an admin action; zone users read + log/raise.
const canManage = requireRole('super_admin', 'client_admin');

// Note: units are never hard-deleted — retire them via PATCH /:id/status.
deviceRouter.get('/', validate(listDevicesSchema), deviceController.list);
deviceRouter.post('/', canManage, validate(createDeviceSchema), deviceController.create);
deviceRouter.get('/:id', validate(getDeviceSchema), deviceController.get);
deviceRouter.patch('/:id', canManage, validate(updateDeviceSchema), deviceController.update);
deviceRouter.patch('/:id/status', canManage, validate(setDeviceStatusSchema), deviceController.setStatus);
// Deploy an in-stock unit into a zone.
deviceRouter.post('/:id/deploy', canManage, validate(deployDeviceSchema), deviceController.deploy);
