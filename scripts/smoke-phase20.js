/**
 * Phase 20 live smoke — health/ready, migrate guard, optional scheduler check.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = process.env.API_ROOT || 'http://127.0.0.1:3000';

async function req(pathname) {
  const res = await fetch(`${ROOT}${pathname}`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const push = spawnSync(
    process.execPath,
    [path.join(__dirname, 'migrate.js'), 'db', 'push'],
    { encoding: 'utf8' },
  );
  assert(push.status !== 0, 'migrate.js must refuse db push');
  assert(
    String(push.stderr || push.stdout).includes('Refusing'),
    'migrate.js refuse message',
  );
  console.log('PASS  migrate deploy guard');

  const health = await req('/health');
  assert(health.status === 200, `health ${health.status}`);
  assert(health.json.data?.status === 'ok' || health.json.status === 'ok', 'health body');
  assert(
    health.headers.get('x-content-type-options') === 'nosniff',
    'helmet nosniff',
  );
  console.log('PASS  health');

  const ready = await req('/ready');
  assert(ready.status === 200, `ready ${ready.status}`);
  const checks = ready.json.data?.checks || ready.json.checks;
  assert(checks?.database?.status === 'ok', 'ready database');
  assert(checks?.redis?.status === 'ok', 'ready redis');
  console.log('PASS  ready');

  console.log('PHASE_20_SMOKE_OK');
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
