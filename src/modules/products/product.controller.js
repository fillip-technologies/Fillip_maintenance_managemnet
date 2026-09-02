import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { productService } from './product.service.js';

export const productController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await productService.list(req.validatedQuery, req.user);
    sendSuccess(res, listPayload(items, meta));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await productService.create(req.body, req.user));
  }),
  remove: asyncHandler(async (req, res) => {
    await productService.remove(req.params.id, req.user);
    sendSuccess(res, { id: req.params.id, deleted: true });
  }),
  audit: asyncHandler(async (req, res) => {
    const { items, meta } = await productService.auditLog(req.validatedQuery, req.user);
    sendSuccess(res, listPayload(items, meta));
  }),
};
