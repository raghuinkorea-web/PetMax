#!/usr/bin/env node
/**
 * Prints every mounted route by walking the live Express router, so the API
 * reference in docs/ is generated from the server rather than hand-maintained.
 */
// Run with:  npx tsx --env-file=.env apps/api/scripts/list-routes.mjs
const { createApp } = await import('../src/app.ts');
const app = createApp();

const routes = [];
const walk = (stack, prefix = '') => {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => m !== '_all');
      for (const method of methods) {
        routes.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const match = layer.regexp?.source
        ?.replace('^\\/', '/')
        .replace('\\/?(?=\\/|$)', '')
        .replace(/\\\//g, '/')
        .replace(/\$$/, '');
      walk(layer.handle.stack, prefix + (match && match !== '/' ? match : ''));
    }
  }
};
walk(app._router.stack);

const order = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
routes.sort((a, b) => a.path.localeCompare(b.path) || order[a.method] - order[b.method]);

console.log(`${routes.length} routes\n`);
let group = '';
for (const r of routes) {
  const g = r.path.split('/')[2] ?? '';
  if (g !== group) { group = g; console.log(`\n  ── /api/${group} ──`); }
  console.log(`  ${r.method.padEnd(6)} ${r.path}`);
}
process.exit(0);
