// Every /api/inventory/v1 route must carry a permission guard (integration plan
// §5.2): the Node equivalent of the FBOS services' unguarded-route test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.INVENTORY_API_ENABLED = 'true';
const { inventoryRouter, OPEN_PATHS } = await import('../src/modules/inventory/router.js');

/** [{ method, path, guarded }] for every route reachable in an Express router. */
function routesOf(router, prefix = '') {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route) {
      const handlers = layer.route.stack.map((s) => s.handle);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: prefix + layer.route.path, guarded: handlers.some((h) => h.isPermissionGuard) });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...routesOf(layer.handle, prefix));
    }
  }
  return out;
}

test('every inventory route is guarded unless it is meant to be open', () => {
  const routes = routesOf(inventoryRouter());
  assert.ok(routes.length > 10, `found only ${routes.length} routes`);
  const unguarded = routes.filter((r) => !r.guarded && !OPEN_PATHS.includes(r.path));
  assert.deepEqual(unguarded, []);
});

test('the open paths are only health checks', () => {
  assert.deepEqual(OPEN_PATHS, ['/health', '/ready']);
});

test('the check notices a route without a guard', async () => {
  const { Router } = await import('express');
  const r = Router();
  r.get('/leaky', (_req, res) => res.json({}));
  assert.deepEqual(routesOf(r).filter((x) => !x.guarded).map((x) => x.path), ['/leaky']);
});
