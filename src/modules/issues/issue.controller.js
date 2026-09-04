import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { issueService } from './issue.service.js';
import { uploadRequestFiles } from '../../middleware/upload.js';

export const issueController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await issueService.list(req.validatedQuery, req.user, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.getById(req.params.id, req.scope));
  }),
  create: asyncHandler(async (req, res) => {
    const attachments = await uploadRequestFiles(req);
    sendCreated(res, await issueService.create({ ...req.body, attachments }, req.user, req.scope));
  }),
  bulkCreate: asyncHandler(async (req, res) => {
    const attachments = await uploadRequestFiles(req);
    sendCreated(res, await issueService.createBulk({ ...req.body, attachments }, req.user, req.scope));
  }),
  bulkStatus: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.bulkTransition(req.body, req.user, req.scope));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.updateDetails(req.params.id, req.body, req.scope));
  }),
  setStatus: asyncHandler(async (req, res) => {
    const { status, notes, changedByUserId } = req.body;
    const attachments = await uploadRequestFiles(req);
    sendSuccess(res, await issueService.transition(
      req.params.id,
      { toStatus: status, notes, changedByUserId, attachments },
      req.user,
      req.scope
    ));
  }),
  assign: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.assign(req.params.id, req.body, req.user, req.scope));
  }),
  history: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.history(req.params.id, req.scope));
  }),
  remove: asyncHandler(async (req, res) => {
    sendSuccess(res, await issueService.remove(req.params.id, req.scope));
  }),
};
