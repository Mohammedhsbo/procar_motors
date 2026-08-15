/**
 * Phase 12 live smoke — suppliers / PR / PO / GRN / inventory
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
    const officer = await req('POST', '/auth/login', {
      body: { email: 'hany@promotors.eg', password: 'Password123!' },
    });
    assert(officer.status === 201, `officer login ${officer.status}`);
    const officerToken = officer.json.data.accessToken;

    const manager = await req('POST', '/auth/login', {
      body: { email: 'mona@promotors.eg', password: 'Password123!' },
    });
    assert(manager.status === 201, `manager login ${manager.status}`);
    const managerToken = manager.json.data.accessToken;
    const store = await req('POST', '/auth/login', {
      body: { email: 'sayed@promotors.eg', password: 'Password123!' },
    });
    assert(store.status === 201, `store login ${store.status}`);
    const storeToken = store.json.data.accessToken;
    // Prefer store-keeper home branch (b1) — purchasing users may also have legacy b2 access
    const b1 = store.json.data.user.branchIds[0];
    log('auth', true, `branch=${b1}`);

    const suppliers = await req('GET', '/suppliers', {
      token: officerToken,
      branchId: b1,
    });
    assert(suppliers.status === 200, `suppliers ${suppliers.status}`);
    const supplier = suppliers.json.data.find((s) => s.nameEn === 'AutoParts Egypt');
    assert(supplier && supplier.nameAr, 'demo supplier bilingual');
    log('GET /suppliers', true, supplier.id);

    const parts = await req('GET', '/parts?q=FLT-0921', {
      token: storeToken,
      branchId: b1,
    });
    assert(parts.status === 200, `parts ${parts.status} ${JSON.stringify(parts.json)}`);
    assert(Array.isArray(parts.json.data), 'parts.data array');
    const part = parts.json.data.find((p) => p.sku === 'FLT-0921');
    assert(part, 'FLT-0921');
    const balBefore = await req('GET', `/inventory/balances?q=FLT-0921`, {
      token: storeToken,
      branchId: b1,
    });
    assert(balBefore.status === 200, `balances ${balBefore.status}`);
    const before = balBefore.json.data[0];
    assert(before, 'balance row');

    const pr = await req('POST', '/purchase-requests', {
      token: officerToken,
      branchId: b1,
      idem: `smoke-pr-${randomUUID()}`,
      body: { reason: 'Smoke restock', items: [{ partId: part.id, qty: 4 }] },
    });
    assert(pr.status === 201, `pr ${pr.status} ${JSON.stringify(pr.json)}`);
    log('create PR', true, pr.json.data.number);

    await req('POST', `/purchase-requests/${pr.json.data.id}/submit`, {
      token: officerToken,
      branchId: b1,
    });
    const denied = await req('POST', `/purchase-requests/${pr.json.data.id}/approve`, {
      token: officerToken,
      branchId: b1,
    });
    assert(denied.status === 403, 'officer cannot approve');
    log('RBAC officer cannot approve', true);

    await req('POST', `/purchase-requests/${pr.json.data.id}/approve`, {
      token: managerToken,
      branchId: b1,
    });
    log('manager approve PR', true);

    const po = await req('POST', '/purchase-orders', {
      token: officerToken,
      branchId: b1,
      idem: `smoke-po-${randomUUID()}`,
      body: {
        supplierId: supplier.id,
        purchaseRequestId: pr.json.data.id,
        autoSubmit: true,
      },
    });
    assert(po.status === 201, `po ${po.status} ${JSON.stringify(po.json)}`);
    log('create PO from PR', true, `${po.json.data.number} total=${po.json.data.total}`);

    const dup = await req('POST', '/purchase-orders', {
      token: officerToken,
      branchId: b1,
      body: { supplierId: supplier.id, purchaseRequestId: pr.json.data.id },
    });
    assert(dup.status === 409, `dup po ${dup.status}`);
    log('duplicate PO blocked', true);

    await req('POST', `/purchase-orders/${po.json.data.id}/approve`, {
      token: managerToken,
      branchId: b1,
    });

    const poItemId = po.json.data.items[0].id;
    const grn = await req('POST', '/goods-receipts', {
      token: storeToken,
      branchId: b1,
      body: {
        poId: po.json.data.id,
        supplierInvoiceRef: 'SMOKE-INV-12',
        items: [{ poItemId, qtyReceived: 4 }],
      },
    });
    assert(grn.status === 201, `grn ${grn.status}`);
    const recvKey = `smoke-recv-${randomUUID()}`;
    const recv = await req('POST', `/goods-receipts/${grn.json.data.id}/receive`, {
      token: storeToken,
      branchId: b1,
      idem: recvKey,
    });
    assert(recv.status === 200, `recv ${recv.status}`);
    const recv2 = await req('POST', `/goods-receipts/${grn.json.data.id}/receive`, {
      token: storeToken,
      branchId: b1,
      idem: recvKey,
    });
    assert(recv2.status === 200, `recv idem ${recv2.status}`);
    log('GRN receive + idempotent', true, recv.json.data.number);

    const balAfter = await req('GET', `/inventory/balances?q=FLT-0921`, {
      token: storeToken,
      branchId: b1,
    });
    const after = balAfter.json.data[0];
    assert(
      Number(after.onHand) === Number(before.onHand) + 4,
      `stock ${before.onHand} -> ${after.onHand}`,
    );
    log('inventory +4 after receive', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
    if (failed.length) process.exit(1);
    console.log('PHASE_12_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
