import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { clientService } from './client.service.js';

export const clientController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await clientService.list(req.validatedQuery);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await clientService.getById(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await clientService.create(req.body));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await clientService.update(req.params.id, req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await clientService.remove(req.params.id);
    res.status(204).send();
  }),
};
