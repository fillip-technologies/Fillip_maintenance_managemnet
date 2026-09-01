import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { userService } from './user.service.js';

export const userController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await userService.list(req.validatedQuery, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await userService.getById(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await userService.create(req.body));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await userService.update(req.params.id, req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    // Hard-delete — the row is removed; authored records survive with a null author.
    await userService.remove(req.params.id);
    sendSuccess(res, { id: req.params.id, deleted: true });
  }),
};
