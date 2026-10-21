// Shared setup for the inventory API tests: the app in-process on a free port,
// the local docker Identity, and the users from fbos_dev_bootstrap.mjs.
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

process.env.INVENTORY_API_ENABLED = 'true';
const file = new URL('./.fbos-dev.json', import.meta.url);
export const dev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const identityUp = dev && (await fetch(`${process.env.FBOS_IDENTITY_URL ?? 'http://localhost:8001'}/health`).then((r) => r.ok).catch(() => false));
const url = process.env.DATABASE_URL ?? '';
export const ready = Boolean(identityUp && /@(localhost|127\.0\.0\.1)[:/]/.test(url) && /\/test_/.test(url));

export async function startKit(people = ['ops', 'site-a', 'site-b', 'tech']) {
  const { prisma } = await import('../../src/lib/prisma.js');
  const { env } = await import('../../src/config/env.js');
  const { createApp } = await import('../../src/app.js');
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/inventory/v1`;
  const tokens = {};
  for (const who of people) {
    const res = await fetch(`${dev.identityUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${who}@fixlydev.example.com`, password: dev.password }),
    });
    tokens[who] = (await res.json()).access_token;
  }
  async function api(path, who, { method = 'GET', body, headers = {}, version, idempotent } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(who ? { authorization: `Bearer ${tokens[who]}`, 'x-organization-id': dev.organizationId } : {}),
        ...(version !== undefined ? { 'if-match': `"${version}"` } : {}),
        ...(idempotent ? { 'idempotency-key': idempotent === true ? randomUUID() : idempotent } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), headers: res.headers };
  }
  return {
    prisma, env, base, tokens, api,
    stop: async () => {
      server.close();
      await prisma.$disconnect();
    },
  };
}
