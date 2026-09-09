import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { ApiError } from '../../utils/ApiError.js';
import { productTypeService } from './productType.service.js';

export const productTypeController = {
  list: asyncHandler(async (req, res) => {
    sendSuccess(res, await productTypeService.list(req.validatedQuery?.categoryId));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await productTypeService.create(req.body));
  }),
  uploadLogo: asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file provided');
    sendSuccess(res, await productTypeService.uploadLogo(req.params.id, req.file.buffer));
  }),
  remove: asyncHandler(async (req, res) => {
    await productTypeService.remove(req.params.id);
    sendSuccess(res, { id: req.params.id, deleted: true });
  }),
};
