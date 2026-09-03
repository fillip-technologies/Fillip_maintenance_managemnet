import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { zoneService } from './zone.service.js';

export const zoneController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await zoneService.list(req.validatedQuery, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.getByIdInScope(req.params.id, req.scope));
  }),
  descendants: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.descendants(req.params.id, req.scope));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await zoneService.create(req.body, req.user, req.scope));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.update(req.params.id, req.body, req.scope));
  }),
  setStatus: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.setStatus(req.params.id, req.body.status, req.scope));
  }),
  assign: asyncHandler(async (req, res) => {
    sendCreated(res, await zoneService.assign(req.params.id, req.body, req.scope));
  }),
  unassign: asyncHandler(async (req, res) => {
    await zoneService.unassign(req.params.id, req.params.assignmentId, req.scope);
    res.status(204).send();
  }),
  activity: asyncHandler(async (req, res) => {
    const result = await zoneService.activity(req.params.id, req.validatedQuery, req.scope);
    sendSuccess(res, result);
  }),
  remove: asyncHandler(async (req, res) => {
    await zoneService.remove(req.params.id, req.scope);
    res.status(204).send();
  }),
  listAssignments: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.listAssignments(req.params.id, req.scope));
  }),
};
