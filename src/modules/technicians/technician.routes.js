import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { technicianController } from './technician.controller.js';
import {
  listTechniciansSchema,
  getTechnicianSchema,
  createTechnicianSchema,
  updateTechnicianSchema,
  deleteTechnicianSchema,
  addAssignmentSchema,
  removeAssignmentSchema,
} from './technician.validation.js';

export const technicianRouter = Router();

technicianRouter.get('/', validate(listTechniciansSchema), technicianController.list);
technicianRouter.post('/', validate(createTechnicianSchema), technicianController.create);
technicianRouter.get('/:id', validate(getTechnicianSchema), technicianController.get);
technicianRouter.patch('/:id', validate(updateTechnicianSchema), technicianController.update);
technicianRouter.delete('/:id', validate(deleteTechnicianSchema), technicianController.remove);

technicianRouter.post('/:id/assignments', validate(addAssignmentSchema), technicianController.addAssignment);
technicianRouter.delete(
  '/:id/assignments/:assignmentId',
  validate(removeAssignmentSchema),
  technicianController.removeAssignment
);
