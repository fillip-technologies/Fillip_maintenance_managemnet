import { z } from 'zod';

const userRole = z.enum([
  'super_admin',
  'company_admin',
  'client_admin',
  'zone_incharge',
  'zone_staff',
  'technician',
]);

const accountStatus = z.enum(['invited', 'active', 'suspended', 'removed']);

const idParam = z.object({
  id: z.string().uuid(),
});

export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).optional(),
    clientId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    role: userRole.optional(),
  }),
});

export const getUserSchema = z.object({
  params: idParam,
});

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    name: z.string().trim().min(1).max(120),
    role: userRole,
    password: z.string().min(8).max(128).optional(),
    companyId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    accountStatus: accountStatus.optional(),
  }),
});

export const updateUserSchema = z.object({
  params: idParam,
  body: z
    .object({
      email: z.string().trim().toLowerCase().email().max(200).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      role: userRole.optional(),
      accountStatus: accountStatus.optional(),
      companyId: z.string().uuid().nullable().optional(),
      clientId: z.string().uuid().nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    }),
});

export const deleteUserSchema = z.object({
  params: idParam,
});
