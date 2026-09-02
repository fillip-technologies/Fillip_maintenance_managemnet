import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { technicianService } from './technician.service.js';

export const technicianController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await technicianService.list(req.validatedQuery);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await technicianService.getById(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await technicianService.create(req.body));
  }),
  provision: asyncHandler(async (req, res) => {
    sendCreated(res, await technicianService.provision(req.body));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await technicianService.update(req.params.id, req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await technicianService.remove(req.params.id);
    res.status(204).send();
  }),
  addAssignment: asyncHandler(async (req, res) => {
    sendCreated(res, await technicianService.addAssignment(req.params.id, req.body));
  }),
  removeAssignment: asyncHandler(async (req, res) => {
    await technicianService.removeAssignment(req.params.id, req.params.assignmentId);
    res.status(204).send();
  }),
};
