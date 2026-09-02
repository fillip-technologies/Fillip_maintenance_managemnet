import { Router } from 'express';
import multer from 'multer';
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

// In-memory upload for Excel/CSV import — capped at 5 MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Note: units are never hard-deleted — retire them via PATCH /:id/status.
deviceRouter.get('/', validate(listDevicesSchema), deviceController.list);
deviceRouter.post('/', canManage, validate(createDeviceSchema), deviceController.create);
deviceRouter.get('/:id', validate(getDeviceSchema), deviceController.get);
deviceRouter.patch('/:id', canManage, validate(updateDeviceSchema), deviceController.update);
deviceRouter.patch('/:id/status', canManage, validate(setDeviceStatusSchema), deviceController.setStatus);
// Deploy an in-stock unit into a zone.
deviceRouter.post('/:id/deploy', canManage, validate(deployDeviceSchema), deviceController.deploy);

// Bulk import (Excel/CSV): download template, then upload with ?dryRun=true to
// preview or without to commit. Field name: "file".
deviceRouter.get('/import/template', canManage, deviceController.importTemplate);
deviceRouter.post('/import', canManage, upload.single('file'), deviceController.importUnits);
