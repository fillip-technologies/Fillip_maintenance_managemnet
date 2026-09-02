import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { productCategoryService } from './productCategory.service.js';

export const productCategoryController = {
  list: asyncHandler(async (_req, res) => {
    sendSuccess(res, await productCategoryService.list());
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await productCategoryService.create(req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await productCategoryService.remove(req.params.id);
    sendSuccess(res, { id: req.params.id, deleted: true });
  }),
};
