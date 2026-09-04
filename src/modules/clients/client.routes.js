import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { clientController } from './client.controller.js';
import {
  listClientsSchema,
  getClientSchema,
  createClientSchema,
  updateClientSchema,
  deleteClientSchema,
} from './client.validation.js';

export const clientRouter = Router();

clientRouter.get('/', validate(listClientsSchema), clientController.list);
clientRouter.post('/', validate(createClientSchema), clientController.create);
// Named sub-routes must be declared before /:id to avoid shadowing
clientRouter.get('/:id/dependents', validate(getClientSchema), clientController.dependents);
clientRouter.get('/:id/export', validate(getClientSchema), clientController.export);
clientRouter.get('/:id', validate(getClientSchema), clientController.get);
clientRouter.patch('/:id', validate(updateClientSchema), clientController.update);
clientRouter.delete('/:id', validate(deleteClientSchema), clientController.remove);
