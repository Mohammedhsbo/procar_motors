/**
 * Phase 13 live smoke — invoices / payments / deliver gate
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
    const b1 = admin.json.data.user.branchIds.find((id) =>
      id.endsWith('00b1'),
    ) || admin.json.data.user.branchIds[0];

    const accountant = await req('POST', '/auth/login', {
      body: { email: 'rania@promotors.eg', password: 'Password123!' },
    });
    assert(accountant.status === 201, `accountant ${accountant.status}`);
    const accountantToken = accountant.json.data.accessToken;
    const advisor = await req('POST', '/auth/login', {
      body: { email: 'mostafa@promotors.eg', password: 'Password123!' },
    });
    const advisorToken = advisor.json.data.accessToken;
    log('auth', true);

    const taxes = await req('GET', '/taxes', {
      token: accountantToken,
      branchId: b1,
    });
    assert(taxes.status === 200 && taxes.json.data.length > 0, 'taxes');
    log('GET /taxes', true);

    const phone = `+20 194 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ف ن ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await req('POST', '/vehicle-visits/check-in', {
      token: adminToken,
      branchId: b1,
      idem: `smoke-fin-${randomUUID()}`,
      body: {
        newCustomer: { nameEn: 'Smoke Fin', nameAr: 'دخان', phone },
        newVehicle: { make: 'MG', model: 'ZS', year: 2022, plate },
        mileage: 10000,
        fuelLevelPct: 60,
        complaint: 'Smoke finance',
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
            nameEn: 'Smoke Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 500,
          },
        ],
      },
    });
    assert(quote.status === 201, `quote ${quote.status}`);
    await req('POST', `/quotations/${quote.json.data.id}/send`, {
      token: advisorToken,
      branchId: b1,
    });
    const approved = await req('POST', `/quotations/${quote.json.data.id}/approve`, {
      token: advisorToken,
      branchId: b1,
    });
    assert(approved.status === 200, `approve ${approved.status}`);

    const inv = await req('POST', '/invoices', {
      token: accountantToken,
      branchId: b1,
      idem: `smoke-inv-${randomUUID()}`,
      body: { quotationId: quote.json.data.id },
    });
    assert(inv.status === 201, `inv ${inv.status} ${JSON.stringify(inv.json)}`);
    log('create invoice', true, inv.json.data.number);

    await req('POST', `/invoices/${inv.json.data.id}/issue`, {
      token: accountantToken,
      branchId: b1,
    });
    const pay = await req('POST', `/invoices/${inv.json.data.id}/pay`, {
      token: accountantToken,
      branchId: b1,
      idem: `smoke-pay-${randomUUID()}`,
      body: { amount: inv.json.data.total, method: 'cash' },
    });
    assert(pay.status === 200 && pay.json.data.status === 'paid', `pay ${pay.status}`);
    log('issue + pay', true, `total=${inv.json.data.total}`);

    const exp = await req('POST', '/expenses', {
      token: accountantToken,
      branchId: b1,
      body: {
        category: 'supplies',
        amount: 75,
        expenseDate: '2026-08-11',
      },
    });
    assert(exp.status === 201, `expense ${exp.status}`);
    log('create expense', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
    if (failed.length) process.exit(1);
    console.log('PHASE_13_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
