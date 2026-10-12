import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { replacementRequestService as svc } from './replacementRequest.service.js';

export const replacementRequestController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await svc.list(req.validatedQuery, req.user, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await svc.getById(req.params.id, req.user, req.scope));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await svc.create(req.body, req.user, req.scope));
  }),
  approve: asyncHandler(async (req, res) => {
    sendSuccess(res, await svc.approve(req.params.id, req.body, req.user, req.scope));
  }),
  reject: asyncHandler(async (req, res) => {
    sendSuccess(res, await svc.reject(req.params.id, req.body, req.user, req.scope));
  }),
  cancel: asyncHandler(async (req, res) => {
    sendSuccess(res, await svc.cancel(req.params.id, req.user, req.scope));
  }),
  complete: asyncHandler(async (req, res) => {
    const { latitude, longitude, notes } = req.body;
    sendSuccess(
      res,
      await svc.complete(
        req.params.id,
        {
          latitude: latitude != null ? Number(latitude) : null,
          longitude: longitude != null ? Number(longitude) : null,
          notes,
        },
        req.user,
        req.scope
      )
    );
  }),
};
