import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { companyController } from './company.controller.js';
import { listCompaniesSchema, getCompanySchema } from './company.validation.js';

export const companyRouter = Router();

// Read-only — there is exactly one company (Fillip Technologies), managed via seed.
companyRouter.get('/', validate(listCompaniesSchema), companyController.list);
companyRouter.get('/:id', validate(getCompanySchema), companyController.get);
