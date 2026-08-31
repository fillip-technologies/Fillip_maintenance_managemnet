import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { hardwareTypeService } from './hardwareType.service.js';

export const hardwareTypeController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await hardwareTypeService.list(req.validatedQuery);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await hardwareTypeService.getById(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await hardwareTypeService.create(req.body));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await hardwareTypeService.update(req.params.id, req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await hardwareTypeService.remove(req.params.id);
    res.status(204).send();
  }),
  addCategory: asyncHandler(async (req, res) => {
    sendCreated(res, await hardwareTypeService.addCategory(req.params.id, req.body));
  }),
  removeCategory: asyncHandler(async (req, res) => {
    await hardwareTypeService.removeCategory(req.params.id, req.params.categoryId);
    res.status(204).send();
  }),
};
