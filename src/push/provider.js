import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Firebase Cloud Messaging provider.
 *
 * Real FCM is used when credentials are present in the environment; otherwise
 * the provider degrades to a no-op that logs and skips. This keeps the server
 * booting (and the smoke/authz suites green) on machines without a Firebase
 * project, while a fully-configured deployment sends live pushes with no code
 * change — only env vars.
 */

let app = null; // firebase-admin app, or null when unconfigured
let resolvedConfigError = null;

/** Build a service-account credential object from whichever env form is set. */
function loadServiceAccount() {
  // Form 1: a single blob — either raw JSON or a path to a JSON key file.
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const raw = env.FIREBASE_SERVICE_ACCOUNT.trim();
    const json = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
    return JSON.parse(json);
  }
  // Form 2: three discrete fields (convenient for flat .env files).
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // .env commonly stores the key with escaped newlines — restore them.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
}

/** Lazily initialize firebase-admin. Safe to call repeatedly. */
export function initPush() {
  if (app || resolvedConfigError) return app;
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      logger.warn('Push disabled: no Firebase credentials configured (FCM sends will be skipped)');
      resolvedConfigError = new Error('unconfigured');
      return null;
    }
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    logger.info('Push (FCM) initialized');
    return app;
  } catch (err) {
    // Bad creds must not crash the process — log once and stay in no-op mode.
    logger.error({ err }, 'Push init failed — FCM sends will be skipped');
    resolvedConfigError = err;
    return null;
  }
}

/** True when a live FCM sender is available. */
export function isPushEnabled() {
  return Boolean(initPush());
}

/**
 * Send one notification to many device tokens.
 * @returns {Promise<{ sent: number, invalidTokens: string[] }>} — `invalidTokens`
 *   are tokens FCM reports as unregistered/invalid so the caller can prune them.
 */
export async function sendToTokens(tokens, { title, body, data }) {
  const unique = [...new Set((tokens ?? []).filter(Boolean))];
  if (unique.length === 0) return { sent: 0, invalidTokens: [] };

  if (!initPush()) {
    logger.debug({ tokens: unique.length, title }, 'Push skipped (provider disabled)');
    return { sent: 0, invalidTokens: [] };
  }

  // FCM data payloads must be string→string.
  const stringData = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])
  );

  const res = await admin.messaging().sendEachForMulticast({
    tokens: unique,
    notification: { title, body },
    data: stringData,
  });

  const invalidTokens = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      invalidTokens.push(unique[i]);
    } else {
      logger.warn({ code, err: r.error?.message }, 'FCM send error for one token');
    }
  });

  return { sent: res.successCount, invalidTokens };
}
