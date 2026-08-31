import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { authService } from './auth.service.js';

export const authController = {
  login: asyncHandler(async (req, res) => {
    sendSuccess(res, await authService.login(req.body));
  }),
  refresh: asyncHandler(async (req, res) => {
    sendSuccess(res, await authService.refresh(req.body.refreshToken));
  }),
  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.body.refreshToken);
    sendSuccess(res, { loggedOut: true });
  }),
  deviceToken: asyncHandler(async (req, res) => {
    sendSuccess(res, await authService.saveDeviceToken(req.user.id, req.body));
  }),
  me: asyncHandler(async (req, res) => {
    sendSuccess(res, req.user);
  }),
};
