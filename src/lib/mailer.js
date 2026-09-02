import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * SMTP mailer (Gmail-friendly).
 *
 * Real email is sent when SMTP_USER + SMTP_PASS are present; otherwise the
 * mailer degrades to a no-op that logs and skips — so the server boots and user
 * creation still succeeds on machines without mail configured. A fully
 * configured deployment sends live email with no code change, only env vars.
 */

let transporter = null;
let resolvedConfigError = null;

/** Lazily build the SMTP transport. Safe to call repeatedly. */
function initMailer() {
  if (transporter || resolvedConfigError) return transporter;
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    logger.warn('Email disabled: no SMTP credentials configured (credential emails will be skipped)');
    resolvedConfigError = new Error('unconfigured');
    return null;
  }
  try {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // false → STARTTLS (587); true → TLS (465)
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    logger.info({ host: env.SMTP_HOST, port: env.SMTP_PORT }, 'Email (SMTP) initialized');
    return transporter;
  } catch (err) {
    // Bad config must not crash the process — log once and stay in no-op mode.
    logger.error({ err }, 'Email init failed — credential emails will be skipped');
    resolvedConfigError = err;
    return null;
  }
}

/** True when a live SMTP sender is available. */
export function isEmailEnabled() {
  return Boolean(initMailer());
}

const fromAddress = () => env.MAIL_FROM || env.SMTP_USER;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Email a newly-created user their login credentials.
 * Never throws — returns { sent: boolean } so a mail failure can't break the
 * user-creation request. Callers should not await-block on delivery guarantees.
 */
export async function sendCredentialsEmail({ to, name, email, password }) {
  const t = initMailer();
  if (!t) {
    logger.debug({ to }, 'Credential email skipped (mailer disabled)');
    return { sent: false, skipped: true };
  }

  const app = env.APP_NAME;
  const loginUrl = env.APP_URL;
  const subject = `Your ${app} account is ready`;
  const text =
    `Hi ${name || ''},\n\n` +
    `An account has been created for you on ${app}.\n\n` +
    `Login email: ${email}\n` +
    `Temporary password: ${password}\n\n` +
    `Sign in here: ${loginUrl}\n\n` +
    `For your security, please change your password after your first login.\n`;
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">` +
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>An account has been created for you on <strong>${escapeHtml(app)}</strong>.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Login email</td><td style="font-weight:600">${escapeHtml(email)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Temporary password</td><td style="font-weight:600">${escapeHtml(password)}</td></tr>` +
    `</table>` +
    `<p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Sign in to ${escapeHtml(app)}</a></p>` +
    `<p style="color:#64748b;font-size:12px">For your security, please change your password after your first login.</p>` +
    `</div>`;

  try {
    const info = await t.sendMail({ from: fromAddress(), to, subject, text, html });
    logger.info({ to, messageId: info.messageId }, 'Credential email sent');
    return { sent: true };
  } catch (err) {
    logger.error({ err, to }, 'Credential email failed to send');
    return { sent: false, error: err.message };
  }
}
