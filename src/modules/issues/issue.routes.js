import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { issueController } from './issue.controller.js';
import {
  listIssuesSchema,
  getIssueSchema,
  createIssueSchema,
  updateIssueSchema,
  transitionIssueSchema,
  assignIssueSchema,
} from './issue.validation.js';

export const issueRouter = Router();

issueRouter.get('/', validate(listIssuesSchema), issueController.list);
issueRouter.post('/', validate(createIssueSchema), issueController.create);
issueRouter.get('/:id', validate(getIssueSchema), issueController.get);
issueRouter.patch('/:id', validate(updateIssueSchema), issueController.update);
issueRouter.get('/:id/history', validate(getIssueSchema), issueController.history);
issueRouter.patch('/:id/status', validate(transitionIssueSchema), issueController.setStatus);
// Only super_admin can assign technicians to issues (work assignment).
issueRouter.patch('/:id/assign', requireRole('super_admin'), validate(assignIssueSchema), issueController.assign);
