import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { userController } from './user.controller.js';
import {
  listUsersSchema,
  getUserSchema,
  createUserSchema,
  updateUserSchema,
  deleteUserSchema,
} from './user.validation.js';

export const userRouter = Router();

// Only admins may create/modify accounts — prevents any authenticated user from
// minting a super_admin (privilege escalation). Fine-grained tenant scoping of
// WHICH users an admin may manage is the next (authorization) phase.
const adminOnly = requireRole('super_admin', 'company_admin', 'client_admin');

userRouter.get('/', validate(listUsersSchema), userController.list);
userRouter.post('/', adminOnly, validate(createUserSchema), userController.create);
userRouter.get('/:id', validate(getUserSchema), userController.get);
userRouter.patch('/:id', adminOnly, validate(updateUserSchema), userController.update);
userRouter.delete('/:id', adminOnly, validate(deleteUserSchema), userController.remove);
