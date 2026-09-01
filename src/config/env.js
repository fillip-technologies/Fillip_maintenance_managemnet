import 'dotenv/config';
import { z } from 'zod';

/**
 * Validate environment variables at startup. The process should fail fast
 * and loudly if a required variable is missing or malformed.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid connection string' }),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // --- Auth (JWT access + refresh) ---
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  // --- Maintenance domain business rules (the "lock-in" decisions) ---
  // Days after an issue is `resolved` before it auto-closes if undisputed.
  AUTO_CLOSE_DAYS: z.coerce.number().int().positive().default(3),
  // Consecutive `not_working` daily logs before a device auto-flags `faulty`.
  FAULTY_THRESHOLD: z.coerce.number().int().positive().default(3),
  // Cascading visibility (an incharge/staff seeing their sub-zones) is always on
  // by design — it is not configurable.
  // If true, a zone incharge may reassign a technician; otherwise admin-only.
  INCHARGE_CAN_REASSIGN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // --- Push notifications (Firebase Cloud Messaging) ---
  // ALL OPTIONAL: when unset, the push provider degrades to a no-op (logs and
  // skips) so the server still boots and the smoke/authz suites stay green
  // without any Firebase project. Provide EITHER a single JSON blob/path in
  // FIREBASE_SERVICE_ACCOUNT (raw JSON or a file path), OR the three discrete
  // fields below (handy for .env where multiline JSON is awkward).
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  // Private key often carries literal "\n" in .env — normalized at load time.
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    '❌ Invalid environment configuration:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
