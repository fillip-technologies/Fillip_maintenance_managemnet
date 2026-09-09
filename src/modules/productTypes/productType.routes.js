import { Router } from 'express';
import multer from 'multer';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { productTypeController } from './productType.controller.js';
import {
  listProductTypesSchema,
  createProductTypeSchema,
  uploadProductTypeLogoSchema,
  deleteProductTypeSchema,
} from './productType.validation.js';

export const productTypeRouter = Router();

const canManage = requireRole('super_admin', 'client_admin');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

productTypeRouter.get('/', validate(listProductTypesSchema), productTypeController.list);
productTypeRouter.post('/', canManage, validate(createProductTypeSchema), productTypeController.create);
productTypeRouter.post('/:id/logo', canManage, validate(uploadProductTypeLogoSchema), upload.single('file'), productTypeController.uploadLogo);
productTypeRouter.delete('/:id', requireRole('super_admin'), validate(deleteProductTypeSchema), productTypeController.remove);
