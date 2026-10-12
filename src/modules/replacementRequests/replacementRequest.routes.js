import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { replacementRequestController as c } from './replacementRequest.controller.js';
import {
  listReplacementRequestsSchema,
  getReplacementRequestSchema,
  createReplacementRequestSchema,
  reviewReplacementRequestSchema,
  completeReplacementRequestSchema,
} from './replacementRequest.validation.js';

export const replacementRequestRouter = Router();

const everyone = requireRole('super_admin', 'client_admin', 'technician');

replacementRequestRouter.get('/', everyone, validate(listReplacementRequestsSchema), c.list);
replacementRequestRouter.post('/', requireRole('technician'), validate(createReplacementRequestSchema), c.create);
replacementRequestRouter.get('/:id', everyone, validate(getReplacementRequestSchema), c.get);
// Approval gate: only the org head or the CEO.
replacementRequestRouter.patch('/:id/approve', requireRole('super_admin', 'client_admin'), validate(reviewReplacementRequestSchema), c.approve);
replacementRequestRouter.patch('/:id/reject', requireRole('super_admin', 'client_admin'), validate(reviewReplacementRequestSchema), c.reject);
// Technician-only follow-ups.
replacementRequestRouter.patch('/:id/cancel', requireRole('technician'), validate(getReplacementRequestSchema), c.cancel);
replacementRequestRouter.post('/:id/complete', requireRole('technician'), validate(completeReplacementRequestSchema), c.complete);
