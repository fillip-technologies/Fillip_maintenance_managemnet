import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authController } from './auth.controller.js';
import { loginSchema, refreshSchema, logoutSchema, deviceTokenSchema } from './auth.validation.js';

export const authRouter = Router();

// Public.
authRouter.post('/login', validate(loginSchema), authController.login);
authRouter.post('/refresh', validate(refreshSchema), authController.refresh);
authRouter.post('/logout', validate(logoutSchema), authController.logout);

// Authenticated.
authRouter.get('/me', authenticate, authController.me);
authRouter.post('/device-token', authenticate, validate(deviceTokenSchema), authController.deviceToken);
