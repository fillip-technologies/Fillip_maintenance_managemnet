import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { dailyLogService } from './dailyLog.service.js';

export const dailyLogController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await dailyLogService.list(req.validatedQuery, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await dailyLogService.create(req.body, req.user, req.scope));
  }),
};
