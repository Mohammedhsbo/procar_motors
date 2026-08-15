/**
 * Phase 17 live smoke — offline sync batch + isolation
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';
const { randomUUID } = require('crypto');

async function req(method, path, { token, branchId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId) headers['X-Branch-Id'] = branchId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    const rec = await req('POST', '/auth/login', {
      body: { email: 'nourhan@promotors.eg', password: 'Password123!' },
    });
    assert(rec.status === 201, `reception ${rec.status}`);
    const token = rec.json.data.accessToken;
    const b1 =
      rec.json.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      rec.json.data.user.branchIds[0];

    const clientId = `smoke-${randomUUID()}`;
    const operationId = randomUUID();
    const phone = `+20 159 ${String(Date.now()).slice(-7)}`;
    const plate = `ك ل ${randomUUID().replace(/-/g, '').slice(0, 6)}`;

    const batch = await req('POST', '/sync/batch', {
      token,
      branchId: b1,
      body: {
        clientId,
        operations: [
          {
            operationId,
            entityType: 'vehicle_visit',
            action: 'create',
            clientTimestamp: new Date().toISOString(),
            payload: {
              newCustomer: { nameEn: 'Smoke Sync', nameAr: 'مزامنة', phone },
              newVehicle: { make: 'Seat', model: 'Ibiza', year: 2021, plate },
              mileage: 5000,
              fuelLevelPct: 60,
              complaint: 'Smoke offline check-in',
              priority: 'normal',
              expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
            },
          },
        ],
      },
    });
    assert(batch.status === 201, `batch ${batch.status} ${JSON.stringify(batch.json)}`);
    const applied = batch.json.data.results[0];
    assert(applied.status === 'applied', `status ${applied.status}`);
    log('sync check-in', true, applied.serverEntityId);

    const replay = await req('POST', '/sync/batch', {
      token,
      branchId: b1,
      body: {
        clientId,
        operations: [
          {
            operationId,
            entityType: 'vehicle_visit',
            action: 'create',
            clientTimestamp: new Date().toISOString(),
            payload: { complaint: 'ignored' },
          },
        ],
      },
    });
    assert(
      replay.json.data.results[0].serverEntityId === applied.serverEntityId,
      'idempotent replay',
    );
    log('duplicate operationId', true);

    const status = await req('GET', `/sync/status/${operationId}?clientId=${clientId}`, {
      token,
      branchId: b1,
    });
    assert(status.status === 200, `status ${status.status}`);
    log('sync status', true);

    const forbidden = await req('POST', '/sync/batch', {
      token,
      branchId: b1,
      body: {
        clientId: `smoke-${randomUUID()}`,
        operations: [
          {
            operationId: randomUUID(),
            entityType: 'invoice',
            action: 'create',
            clientTimestamp: new Date().toISOString(),
            payload: { total: 1 },
          },
        ],
      },
    });
    assert(forbidden.json.data.results[0].status === 'failed', 'invoice blocked');
    log('offline finance blocked', true);

    const otp = await req('POST', '/portal/auth/request-otp', {
      body: { phone: '+20 100 214 8890' },
    });
    const verify = await req('POST', '/portal/auth/verify-otp', {
      body: { phone: '+20 100 214 8890', code: otp.json.data.devCode },
    });
    const portalBlock = await req('POST', '/sync/batch', {
      token: verify.json.data.accessToken,
      branchId: b1,
      body: {
        clientId: `c-${randomUUID()}`,
        operations: [
          {
            operationId: randomUUID(),
            entityType: 'customer',
            action: 'create',
            clientTimestamp: new Date().toISOString(),
            payload: { nameEn: 'X', nameAr: 'س', phone: '+20 100 000 0000' },
          },
        ],
      },
    });
    assert(portalBlock.status === 403, `portal sync ${portalBlock.status}`);
    log('customer blocked from sync', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_17_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
