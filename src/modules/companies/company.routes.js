import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { companyController } from './company.controller.js';
import {
  listCompaniesSchema,
  getCompanySchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
} from './company.validation.js';

export const companyRouter = Router();

companyRouter.get('/', validate(listCompaniesSchema), companyController.list);
companyRouter.post('/', validate(createCompanySchema), companyController.create);
companyRouter.get('/:id', validate(getCompanySchema), companyController.get);
companyRouter.patch('/:id', validate(updateCompanySchema), companyController.update);
companyRouter.delete('/:id', validate(deleteCompanySchema), companyController.remove);
