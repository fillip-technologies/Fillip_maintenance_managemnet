import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { ApiError } from '../../utils/ApiError.js';
import { deviceService } from './device.service.js';
import { deviceImportService } from './deviceImport.service.js';

export const deviceController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await deviceService.list(req.validatedQuery, req.scope);
    sendSuccess(res, listPayload(items, meta));
  }),
  get: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.getById(req.params.id, req.scope));
  }),
  create: asyncHandler(async (req, res) => {
    sendCreated(res, await deviceService.createUnit(req.body, req.user, req.scope));
  }),
  deploy: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.deploy(req.params.id, req.body.zoneId, req.user, req.scope));
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.update(req.params.id, req.body, req.scope));
  }),
  setStatus: asyncHandler(async (req, res) => {
    sendSuccess(res, await deviceService.setStatus(req.params.id, req.body.status, req.scope));
  }),

  // --- Bulk import ---
  importTemplate: asyncHandler(async (_req, res) => {
    const buffer = await deviceImportService.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="units_import_template.xlsx"');
    res.send(Buffer.from(buffer));
  }),
  importUnits: asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded (field name: file)');
    const companyId = req.body.companyId || req.query.companyId;
    const dryRun = req.query.dryRun === 'true';
    const result = dryRun
      ? await deviceImportService.dryRun(req.file.buffer, req.user, req.scope, companyId)
      : await deviceImportService.commit(req.file.buffer, req.user, req.scope, companyId);
    sendSuccess(res, result);
  }),
};
