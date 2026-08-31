import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { companyService } from './company.service.js';

export const companyController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await companyService.list(req.validatedQuery);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await companyService.getById(req.params.id));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await companyService.create(req.body));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await companyService.update(req.params.id, req.body));
  }),
  remove: asyncHandler(async (req, res) => {
    await companyService.remove(req.params.id);
    res.status(204).send();
  }),
};
