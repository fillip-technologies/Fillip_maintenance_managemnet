import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** Sign a short-lived access token carrying the identity + scope claims. */
export function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

/**
 * Refresh tokens are opaque random strings. We hand the raw value to the client
 * and store only its SHA-256 hash, so a DB leak can't be replayed.
 */
export function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function refreshExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return d;
}
