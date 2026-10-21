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
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5000),

  // --- Auth (JWT access + refresh) ---
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('7d'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),

  // --- Prisma connection pool ---
  // Raise pool_timeout beyond the 10s default so that bursts of parallel queries
  // (e.g. the 23-query overview) queue safely instead of throwing "Database request error".
  PRISMA_POOL_SIZE: z.coerce.number().int().positive().default(5),
  PRISMA_POOL_TIMEOUT: z.coerce.number().int().positive().default(30),
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

  // --- Cloudinary (image / video attachments on issues) ---
  // ALL OPTIONAL: when unset the upload middleware degrades to a no-op.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY:    z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- Outbound email (SMTP) ---
  // Used to email new users their login credentials. ALL OPTIONAL: when
  // SMTP_USER/SMTP_PASS are unset the mailer degrades to a no-op (logs and
  // skips), so the server still boots and user creation still succeeds without
  // email configured. For Gmail: SMTP_USER = your address, SMTP_PASS = a 16-char
  // App Password (NOT your normal password; requires 2FA enabled).
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'), // false = STARTTLS on 587; true = TLS on 465
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // From header; defaults to SMTP_USER when unset.
  MAIL_FROM: z.string().optional(),
  APP_NAME: z.string().default('Fixly'),
  // Base URL of the frontend, used in email copy (login link).
  APP_URL: z.string().default('http://localhost:5173'),

  // --- Fixly v2 inventory service (FBOS integration) ---
  // The FBOS Identity organization that runs the hardware business. Stamped on
  // every inventory row; the v2 API only answers callers acting in it.
  FBOS_ORGANIZATION_ID: z.string().uuid().optional(),
  // Open decision D3: who owns a device after delivery. Default for backfilled
  // and newly registered devices until the product owner answers.
  INVENTORY_DEFAULT_OWNERSHIP: z
    .enum(['platform_owned', 'company_owned', 'client_owned', 'leased'])
    .default('company_owned'),
  // Mounts /api/inventory/v1. Off by default so a deploy never exposes it before
  // Identity carries the inventory permission codes.
  INVENTORY_API_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  FBOS_IDENTITY_URL: z.string().url().default('http://localhost:8001'),
  FBOS_COMMUNICATION_URL: z.string().url().optional(),
  // Shared with every FBOS service (X-FBOS-Internal-Token). Identity skips the
  // check in development when it is unset.
  FBOS_INTERNAL_TOKEN: z.string().default(''),
  FBOS_IDENTITY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // Seconds an Identity actor answer is reused, like the legacy authenticate cache.
  FBOS_ACTOR_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  // Open question 12: hours to resolve an issue, per priority (sets issues.sla_due_at).
  INVENTORY_SLA_HOURS: z
    .string()
    .default('critical:4,high:24,medium:72,low:168')
    .transform((s) => Object.fromEntries(s.split(',').map((pair) => pair.split(':')).map(([k, v]) => [k.trim(), Number(v)]))),
  // Run the outbox worker inside this process (off in tests and one-off scripts).
  OUTBOX_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
