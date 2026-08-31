import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { zoneService } from './zone.service.js';

export const zoneController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await zoneService.list(req.validatedQuery);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.getById(req.params.id));
  }),
  descendants: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.descendants(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await zoneService.create(req.body, req.user));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.update(req.params.id, req.body));
  }),
  setStatus: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.setStatus(req.params.id, req.body.status));
  }),
  assign: asyncHandler(async (req, res) => {
    sendCreated(res, await zoneService.assign(req.params.id, req.body));
  }),
  unassign: asyncHandler(async (req, res) => {
    await zoneService.unassign(req.params.id, req.params.assignmentId);
    res.status(204).send();
  }),
  listAssignments: asyncHandler(async (req, res) => {
    sendSuccess(res, await zoneService.listAssignments(req.params.id));
  }),
};
