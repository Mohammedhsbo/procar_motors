/**
 * Phase 14 live smoke — notifications + outbox drain + scheduled jobs
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';
const { randomUUID } = require('crypto');

async function req(method, path, { token, branchId, body, idem } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId) headers['X-Branch-Id'] = branchId;
  if (idem) headers['Idempotency-Key'] = idem;
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
    const admin = await req('POST', '/auth/login', {
      body: { email: 'kareem@promotors.eg', password: 'Password123!' },
    });
    assert(admin.status === 201, `admin ${admin.status}`);
    const adminToken = admin.json.data.accessToken;
    const b1 =
      admin.json.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      admin.json.data.user.branchIds[0];

    const advisor = await req('POST', '/auth/login', {
      body: { email: 'mostafa@promotors.eg', password: 'Password123!' },
    });
    const advisorToken = advisor.json.data.accessToken;

    const drain = await req('POST', '/jobs/run/outbox-drain', {
      token: adminToken,
    });
    assert(drain.status === 200, `drain ${drain.status} ${JSON.stringify(drain.json)}`);
    log('outbox-drain', true, JSON.stringify(drain.json.data));

    const expiry = await req('POST', '/jobs/run/quotation-expiry', {
      token: adminToken,
    });
    assert(expiry.status === 200, `expiry ${expiry.status}`);
    log('quotation-expiry trigger', true);

    const scan = await req('POST', '/jobs/run/low-stock-scan', {
      token: adminToken,
    });
    assert(scan.status === 200, `scan ${scan.status}`);
    log('low-stock-scan trigger', true);

    // Create quote approve to generate notification
    const phone = `+20 197 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `س ك ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await req('POST', '/vehicle-visits/check-in', {
      token: adminToken,
      branchId: b1,
      idem: `smoke-n14-${randomUUID()}`,
      body: {
        newCustomer: { nameEn: 'Smoke Notif', nameAr: 'إشعار', phone },
        newVehicle: { make: 'Chery', model: 'Arrizo', year: 2021, plate },
        mileage: 8000,
        fuelLevelPct: 50,
        complaint: 'Smoke notifications',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      },
    });
    assert(checkin.status === 201, `checkin ${checkin.status}`);
    const visitId = checkin.json.data.id;
    await req('POST', `/vehicle-visits/${visitId}/transition`, {
      token: adminToken,
      branchId: b1,
      body: { status: 'inspection', version: 1 },
    });
    await req('POST', `/vehicle-visits/${visitId}/transition`, {
      token: adminToken,
      branchId: b1,
      body: { status: 'waitingApproval', version: 2 },
    });
    const quote = await req('POST', '/quotations', {
      token: advisorToken,
      branchId: b1,
      body: {
        visitId,
        items: [
          {
            kind: 'labor',
            nameEn: 'Smoke N',
            nameAr: 'ع',
            qty: 1,
            unitPrice: 150,
          },
        ],
      },
    });
    await req('POST', `/quotations/${quote.json.data.id}/send`, {
      token: advisorToken,
      branchId: b1,
    });
    await req('POST', `/quotations/${quote.json.data.id}/approve`, {
      token: advisorToken,
      branchId: b1,
    });

    await new Promise((r) => setTimeout(r, 4000));
    await req('POST', '/jobs/run/outbox-drain', { token: adminToken });

    const notifs = await req('GET', '/notifications', {
      token: advisorToken,
      branchId: b1,
    });
    assert(notifs.status === 200, `notifs ${notifs.status}`);
    assert(Array.isArray(notifs.json.data), 'notifs array');
    log(
      'notifications list',
      true,
      `count=${notifs.json.data.length} unreadMeta=${notifs.json.meta?.unreadCount}`,
    );

    const prefs = await req('GET', '/notification-preferences', {
      token: advisorToken,
    });
    assert(prefs.status === 200, `prefs ${prefs.status}`);
    log('notification-preferences', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_14_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
