import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { uploadMiddleware } from '../../middleware/upload.js';
import { clientController } from './client.controller.js';
import {
  listClientsSchema,
  getClientSchema,
  createClientSchema,
  updateClientSchema,
  deleteClientSchema,
  uploadClientImageSchema,
} from './client.validation.js';

export const clientRouter = Router();

clientRouter.get('/', validate(listClientsSchema), clientController.list);
clientRouter.post('/', validate(createClientSchema), clientController.create);
// Named sub-routes must be declared before /:id to avoid shadowing
clientRouter.post('/upload-image', uploadMiddleware.single('file'), clientController.uploadImageDirect);
clientRouter.get('/:id/dependents', validate(getClientSchema), clientController.dependents);
clientRouter.get('/:id/export', validate(getClientSchema), clientController.export);
clientRouter.get('/:id', validate(getClientSchema), clientController.get);
clientRouter.post('/:id/image', validate(uploadClientImageSchema), uploadMiddleware.single('file'), clientController.uploadImage);
clientRouter.patch('/:id', validate(updateClientSchema), clientController.update);
clientRouter.delete('/:id', validate(deleteClientSchema), clientController.remove);
