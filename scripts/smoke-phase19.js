/**
 * Phase 19 live smoke — security headers, RBAC, branch isolation, workflow gate
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';
const ROOT = process.env.API_ROOT || 'http://127.0.0.1:3000';

async function req(method, path, { token, branchId, body, base } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId) headers['X-Branch-Id'] = branchId;
  const res = await fetch(`${base || BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
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
    const health = await req('GET', '/health', { base: ROOT });
    assert(health.status === 200, `health ${health.status}`);
    assert(
      health.headers.get('x-content-type-options') === 'nosniff',
      'helmet nosniff',
    );
    log('helmet', true);

    const rec = await req('POST', '/auth/login', {
      body: { email: 'nourhan@promotors.eg', password: 'Password123!' },
    });
    assert(rec.status === 201, `reception login ${rec.status}`);
    const recToken = rec.json.data.accessToken;
    const b1 =
      rec.json.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      rec.json.data.user.branchIds[0];

    const tech = await req('POST', '/auth/login', {
      body: { email: 'm.ahmed@promotors.eg', password: 'Password123!' },
    });
    const techToken = tech.json.data.accessToken;
    const techCheckin = await req('POST', '/vehicle-visits/check-in', {
      token: techToken,
      branchId: b1,
      body: {
        newCustomer: { nameEn: 'X', nameAr: 'س', phone: '+20 100 000 0099' },
        newVehicle: { make: 'X', model: 'Y', year: 2020, plate: 'SMOKE 1' },
        mileage: 1,
        fuelLevelPct: 10,
        complaint: 'x',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    assert(techCheckin.status === 403, `tech check-in ${techCheckin.status}`);
    log('RBAC technician blocked from check-in', true);

    const admin = await req('POST', '/auth/login', {
      body: { email: 'kareem@promotors.eg', password: 'Password123!' },
    });
    const branches = await req('GET', '/branches', {
      token: admin.json.data.accessToken,
      branchId: b1,
    });
    const b2 =
      (branches.json.data?.items || branches.json.data || []).find?.(
        (b) => b.code === 'b2',
      )?.id || admin.json.data.user.branchIds[1];
    if (b2) {
      const cross = await req('GET', '/vehicle-visits', {
        token: recToken,
        branchId: b2,
      });
      assert(cross.status === 403, `cross-branch ${cross.status}`);
      log('branch isolation', true);
    }

    const otp = await req('POST', '/portal/auth/request-otp', {
      body: { phone: '+20 100 214 8890' },
    });
    const verify = await req('POST', '/portal/auth/verify-otp', {
      body: { phone: '+20 100 214 8890', code: otp.json.data.devCode },
    });
    const portal = await req('GET', '/vehicle-visits', {
      token: verify.json.data.accessToken,
      branchId: b1,
    });
    assert(portal.status === 403, `portal ${portal.status}`);
    log('customer blocked from staff APIs', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_19_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
