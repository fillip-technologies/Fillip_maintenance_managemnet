import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { deviceService } from './device.service.js';

export const deviceController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await deviceService.list(req.validatedQuery, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.getById(req.params.id, req.scope));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await deviceService.create(req.body, req.user, req.scope));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.update(req.params.id, req.body, req.scope));
  }),
  setStatus: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.setStatus(req.params.id, req.body.status, req.scope));
  }),
};
