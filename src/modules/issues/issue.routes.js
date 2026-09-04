import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { uploadMiddleware } from '../../middleware/upload.js';
import { issueController } from './issue.controller.js';
import {
  listIssuesSchema,
  getIssueSchema,
  createIssueSchema,
  createBulkIssueSchema,
  bulkStatusSchema,
  updateIssueSchema,
  transitionIssueSchema,
  assignIssueSchema,
} from './issue.validation.js';

export const issueRouter = Router();

issueRouter.get('/', validate(listIssuesSchema), issueController.list);
issueRouter.post('/', uploadMiddleware.array('attachments', 5), validate(createIssueSchema), issueController.create);
issueRouter.post('/bulk', uploadMiddleware.array('attachments', 5), validate(createBulkIssueSchema), issueController.bulkCreate);
issueRouter.patch('/bulk-status', validate(bulkStatusSchema), issueController.bulkStatus);
issueRouter.get('/:id', validate(getIssueSchema), issueController.get);
issueRouter.patch('/:id', validate(updateIssueSchema), issueController.update);
issueRouter.get('/:id/history', validate(getIssueSchema), issueController.history);
issueRouter.patch('/:id/status', uploadMiddleware.array('attachments', 5), validate(transitionIssueSchema), issueController.setStatus);
// Only super_admin can assign technicians to issues (work assignment).
issueRouter.patch('/:id/assign', requireRole('super_admin'), validate(assignIssueSchema), issueController.assign);
// client_admin and super_admin can delete issues.
issueRouter.delete('/:id', requireRole('super_admin', 'client_admin'), validate(getIssueSchema), issueController.remove);
