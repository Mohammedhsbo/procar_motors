/**
 * Phase 11 live smoke — inventory / parts / reservations / WO integration
 * Run: node scripts/smoke-inventory.js
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';

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

function uuid() {
  return require('crypto').randomUUID();
}

(async () => {
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    const login = await req('POST', '/auth/login', {
      body: { email: 'sayed@promotors.eg', password: 'Password123!' },
    });
    assert(login.status === 201, `store login ${login.status}`);
    const storeToken = login.json.data.accessToken;
    const b1 = login.json.data.user.branchIds[0];
    log('store_keeper login', true, b1);

    const advisorLogin = await req('POST', '/auth/login', {
      body: { email: 'mostafa@promotors.eg', password: 'Password123!' },
    });
    const advisorToken = advisorLogin.json.data.accessToken;
    const adminLogin = await req('POST', '/auth/login', {
      body: { email: 'kareem@promotors.eg', password: 'Password123!' },
    });
    const adminToken = adminLogin.json.data.accessToken;

    const parts = await req('GET', '/parts?q=BRK-1042', {
      token: storeToken,
      branchId: b1,
    });
    assert(parts.status === 200, `parts ${parts.status}`);
    const brk = parts.json.data.find((p) => p.sku === 'BRK-1042');
    assert(brk, 'BRK-1042 missing');
    assert(brk.nameEn && brk.nameAr, 'bilingual names');
    log('GET /parts bilingual catalog', true, brk.sku);

    const summary = await req('GET', '/inventory/summary', {
      token: storeToken,
      branchId: b1,
    });
    assert(summary.status === 200, `summary ${summary.status}`);
    log('GET /inventory/summary', true, JSON.stringify(summary.json.data));

    const balances = await req('GET', '/inventory/balances?q=BRK-1042', {
      token: storeToken,
      branchId: b1,
    });
    assert(balances.status === 200 && balances.json.data.length >= 1, 'balances');
    const before = balances.json.data[0];
    log(
      'stock balance shape',
      true,
      `onHand=${before.onHand} reserved=${before.reserved} available=${before.available}`,
    );
    assert(
      Number(before.available) === Number(before.onHand) - Number(before.reserved),
      'available != onHand - reserved',
    );

    // Create visit → quote with part → approve (auto-reserve)
    const phone = `+20 199 ${uuid().replace(/-/g, '').slice(0, 7)}`;
    const plate = `س م ${uuid().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await req('POST', '/vehicle-visits/check-in', {
      token: adminToken,
      branchId: b1,
      idem: `smoke-ci-${uuid()}`,
      body: {
        newCustomer: { nameEn: 'Smoke Inv', nameAr: 'دخان', phone },
        newVehicle: { make: 'Hyundai', model: 'Elantra', year: 2020, plate },
        mileage: 50000,
        fuelLevelPct: 40,
        complaint: 'Phase 11 smoke',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      },
    });
    assert(checkin.status === 201, `checkin ${checkin.status} ${JSON.stringify(checkin.json)}`);
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
            kind: 'part',
            partId: brk.id,
            nameEn: brk.nameEn,
            nameAr: brk.nameAr,
            qty: 2,
            unitPrice: brk.sell,
          },
          {
            kind: 'labor',
            nameEn: 'Install pads',
            nameAr: 'تركيب',
            qty: 1,
            unitPrice: 300,
          },
        ],
      },
    });
    assert(quote.status === 201, `quote ${quote.status}`);
    const quoteId = quote.json.data.id;
    await req('POST', `/quotations/${quoteId}/send`, {
      token: advisorToken,
      branchId: b1,
    });
    const approved = await req('POST', `/quotations/${quoteId}/approve`, {
      token: advisorToken,
      branchId: b1,
    });
    assert(approved.status === 200, `approve ${approved.status} ${JSON.stringify(approved.json)}`);
    const hook = approved.json.data.hooks?.partReservation;
    assert(hook && Array.isArray(hook.reserved), 'partReservation hook');
    assert(hook.reserved.length >= 1, 'expected reserved parts');
    const woId = approved.json.data.workOrder.id;
    log('approve auto-reserve', true, `reserved=${hook.reserved.length} wo=${approved.json.data.workOrder.number}`);

    const midBal = await req('GET', '/inventory/balances?q=BRK-1042', {
      token: storeToken,
      branchId: b1,
    });
    const mid = midBal.json.data[0];
    assert(
      Number(mid.reserved) === Number(before.reserved) + 2,
      `reserved expected +2 got ${mid.reserved} vs ${before.reserved}`,
    );
    log('reserve increases reserved / decreases available', true);

    const reservations = await req('GET', `/inventory/reservations?workOrderId=${woId}`, {
      token: storeToken,
      branchId: b1,
    });
    assert(reservations.status === 200, `list res ${reservations.status}`);
    const resRow = reservations.json.data.find((r) => r.status === 'active');
    assert(resRow, 'active reservation missing');
    const reservationId = resRow.id;

    // Insufficient stock
    const insuff = await req('POST', '/inventory/reservations', {
      token: storeToken,
      branchId: b1,
      body: { partId: brk.id, workOrderId: woId, qty: 999999 },
    });
    assert(insuff.status === 409, `insuff status ${insuff.status}`);
    assert(insuff.json.error?.code === 'INSUFFICIENT_STOCK', insuff.json.error?.code);
    log('insufficient stock rejected', true);

    // Consume
    const consume = await req('POST', `/inventory/reservations/${reservationId}/consume`, {
      token: storeToken,
      branchId: b1,
      idem: `smoke-consume-${uuid()}`,
      body: {},
    });
    assert(consume.status === 200, `consume ${consume.status} ${JSON.stringify(consume.json)}`);
    assert(consume.json.data.status === 'consumed', consume.json.data.status);
    const afterConsume = (
      await req('GET', '/inventory/balances?q=BRK-1042', {
        token: storeToken,
        branchId: b1,
      })
    ).json.data[0];
    assert(
      Number(afterConsume.onHand) === Number(mid.onHand) - 2,
      'onHand not reduced',
    );
    assert(
      Number(afterConsume.reserved) === Number(mid.reserved) - 2,
      'reserved not reduced on consume',
    );
    log('consume reduces onHand + reserved', true);

    // Return 1
    const ret = await req('POST', '/inventory/returns', {
      token: storeToken,
      branchId: b1,
      body: { partId: brk.id, qty: 1, workOrderId: woId },
    });
    assert(ret.status === 201 || ret.status === 200, `return ${ret.status}`);
    const afterReturn = (
      await req('GET', '/inventory/balances?q=BRK-1042', {
        token: storeToken,
        branchId: b1,
      })
    ).json.data[0];
    assert(
      Number(afterReturn.onHand) === Number(afterConsume.onHand) + 1,
      'return did not restore onHand',
    );
    log('return restores onHand', true);

    // Manual reserve + release on another WO path — create second reservation via API
    // Use oil part for release path
    const oilParts = await req('GET', '/parts?q=OIL-5W30', {
      token: storeToken,
      branchId: b1,
    });
    const oil = oilParts.json.data.find((p) => p.sku === 'OIL-5W30');
    const oilBefore = (
      await req('GET', '/inventory/balances?q=OIL-5W30', {
        token: storeToken,
        branchId: b1,
      })
    ).json.data[0];
    const manRes = await req('POST', '/inventory/reservations', {
      token: storeToken,
      branchId: b1,
      idem: `smoke-res-${uuid()}`,
      body: { partId: oil.id, workOrderId: woId, qty: 1 },
    });
    assert(manRes.status === 201 || manRes.status === 200, `manual reserve ${manRes.status}`);
    const release = await req(
      'POST',
      `/inventory/reservations/${manRes.json.data.id}/release`,
      { token: storeToken, branchId: b1, body: {} },
    );
    assert(release.status === 200, `release ${release.status}`);
    const oilAfter = (
      await req('GET', '/inventory/balances?q=OIL-5W30', {
        token: storeToken,
        branchId: b1,
      })
    ).json.data[0];
    assert(
      Number(oilAfter.reserved) === Number(oilBefore.reserved),
      'release did not restore reserved',
    );
    log('manual reserve + release', true);

    const txns = await req('GET', '/inventory/transactions?limit=5', {
      token: storeToken,
      branchId: b1,
    });
    assert(txns.status === 200 && txns.json.data.length > 0, 'transactions');
    log('GET /inventory/transactions ledger', true, `n=${txns.json.data.length}`);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
    if (failed.length) process.exit(1);
    console.log('PHASE_11_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
