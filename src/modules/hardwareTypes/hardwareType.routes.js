import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { hardwareTypeController } from './hardwareType.controller.js';
import {
  listHardwareTypesSchema,
  getHardwareTypeSchema,
  createHardwareTypeSchema,
  updateHardwareTypeSchema,
  deleteHardwareTypeSchema,
  createCategorySchema,
  deleteCategorySchema,
} from './hardwareType.validation.js';

export const hardwareTypeRouter = Router();

hardwareTypeRouter.get('/', validate(listHardwareTypesSchema), hardwareTypeController.list);
hardwareTypeRouter.post('/', validate(createHardwareTypeSchema), hardwareTypeController.create);
hardwareTypeRouter.get('/:id', validate(getHardwareTypeSchema), hardwareTypeController.get);
hardwareTypeRouter.patch('/:id', validate(updateHardwareTypeSchema), hardwareTypeController.update);
hardwareTypeRouter.delete('/:id', validate(deleteHardwareTypeSchema), hardwareTypeController.remove);

// Issue categories nested under a hardware type.
hardwareTypeRouter.post('/:id/categories', validate(createCategorySchema), hardwareTypeController.addCategory);
hardwareTypeRouter.delete(
  '/:id/categories/:categoryId',
  validate(deleteCategorySchema),
  hardwareTypeController.removeCategory
);
