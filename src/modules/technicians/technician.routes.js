import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { technicianController } from './technician.controller.js';
import {
  listTechniciansSchema,
  getTechnicianSchema,
  createTechnicianSchema,
  provisionTechnicianSchema,
  updateTechnicianSchema,
  deleteTechnicianSchema,
  addAssignmentSchema,
  removeAssignmentSchema,
} from './technician.validation.js';

export const technicianRouter = Router();

// Read-only routes — accessible to all authenticated users for visibility.
technicianRouter.get('/', validate(listTechniciansSchema), technicianController.list);
technicianRouter.get('/:id', validate(getTechnicianSchema), technicianController.get);

// Write routes — only super_admin can create, update, or delete technicians.
// `provision` creates the login user + technician profile in one atomic call
// (used by the web portal); the plain `create` promotes an existing user.
technicianRouter.post('/provision', requireRole('super_admin'), validate(provisionTechnicianSchema), technicianController.provision);
technicianRouter.post('/', requireRole('super_admin'), validate(createTechnicianSchema), technicianController.create);
technicianRouter.patch('/:id', requireRole('super_admin'), validate(updateTechnicianSchema), technicianController.update);
technicianRouter.delete('/:id', requireRole('super_admin'), validate(deleteTechnicianSchema), technicianController.remove);

// Assignment management — only super_admin can manage technician coverage assignments.
technicianRouter.post('/:id/assignments', requireRole('super_admin'), validate(addAssignmentSchema), technicianController.addAssignment);
technicianRouter.delete(
  '/:id/assignments/:assignmentId',
  requireRole('super_admin'),
  validate(removeAssignmentSchema),
  technicianController.removeAssignment
);
