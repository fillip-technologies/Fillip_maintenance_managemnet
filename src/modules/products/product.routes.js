import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { productController } from './product.controller.js';
import {
  listProductsSchema,
  createProductSchema,
  deleteProductSchema,
  productAuditSchema,
} from './product.validation.js';

export const productRouter = Router();

// Inventory is managed by super_admin (any company) and client_admin (their own
// company only — enforced in the service). Both can create and delete anytime.
const inventoryRoles = requireRole('super_admin', 'client_admin');

// Audit trail is a super-admin-only view (who changed inventory, incl. deletes).
productRouter.get('/audit', requireRole('super_admin'), validate(productAuditSchema), productController.audit);

productRouter.get('/', inventoryRoles, validate(listProductsSchema), productController.list);
productRouter.post('/', inventoryRoles, validate(createProductSchema), productController.create);
productRouter.delete('/:id', inventoryRoles, validate(deleteProductSchema), productController.remove);
