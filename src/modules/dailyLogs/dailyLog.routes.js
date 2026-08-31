import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { dailyLogController } from './dailyLog.controller.js';
import { listLogsSchema, createLogSchema } from './dailyLog.validation.js';

export const dailyLogRouter = Router();

dailyLogRouter.get('/', validate(listLogsSchema), dailyLogController.list);
dailyLogRouter.post('/', validate(createLogSchema), dailyLogController.create);
