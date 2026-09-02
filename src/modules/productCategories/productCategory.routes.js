import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { productCategoryController } from './productCategory.controller.js';
import { createCategorySchema, deleteCategorySchema } from './productCategory.validation.js';

export const productCategoryRouter = Router();

// Categories are a GLOBAL, shared list. Any authenticated user may read them
// (to file/label units); only the CEO (super_admin) may create or delete.
productCategoryRouter.get('/', productCategoryController.list);
productCategoryRouter.post('/', requireRole('super_admin'), validate(createCategorySchema), productCategoryController.create);
productCategoryRouter.delete('/:id', requireRole('super_admin'), validate(deleteCategorySchema), productCategoryController.remove);
