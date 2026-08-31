import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
  }),
});

export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(1) }),
});

export const logoutSchema = z.object({
  body: z.object({ refreshToken: z.string().min(1) }),
});

export const deviceTokenSchema = z.object({
  body: z.object({
    token: z.string().min(1).max(512),
    platform: z.enum(['android', 'ios', 'web']),
  }),
});
