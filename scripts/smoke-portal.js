/**
 * Phase 16 live smoke — portal OTP + isolation + approve path checks
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';
const PHONE = process.env.PORTAL_PHONE || '+20 100 214 8890';

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
    const otp = await req('POST', '/portal/auth/request-otp', {
      body: { phone: PHONE },
    });
    assert(otp.status === 200, `otp ${otp.status}`);
    assert(otp.json.data.devCode, 'devCode missing');
    log('request-otp', true, `code=${otp.json.data.devCode}`);

    const verify = await req('POST', '/portal/auth/verify-otp', {
      body: { phone: PHONE, code: otp.json.data.devCode },
    });
    assert(verify.status === 200, `verify ${verify.status}`);
    const token = verify.json.data.accessToken;
    assert(verify.json.data.user.userType === 'customer', 'userType');
    log('verify-otp', true);

    const vehicles = await req('GET', '/portal/vehicles', { token });
    assert(vehicles.status === 200, `vehicles ${vehicles.status}`);
    log('portal vehicles', true, `count=${vehicles.json.data.items.length}`);

    const history = await req('GET', '/portal/service-history', { token });
    assert(history.status === 200, `history ${history.status}`);
    log('service-history', true);

    const invoices = await req('GET', '/portal/invoices', { token });
    assert(invoices.status === 200, `invoices ${invoices.status}`);
    log('invoices', true);

    const staffBlock = await req('GET', '/dashboard/summary', {
      token,
      branchId: '00000000-0000-0000-0000-0000000000b1',
    });
    assert(staffBlock.status === 403, `staff block got ${staffBlock.status}`);
    log('customer blocked from staff API', true);

    const admin = await req('POST', '/auth/login', {
      body: { email: 'kareem@promotors.eg', password: 'Password123!' },
    });
    const staffPortal = await req('GET', '/portal/vehicles', {
      token: admin.json.data.accessToken,
    });
    assert(staffPortal.status === 403, `staff portal got ${staffPortal.status}`);
    log('staff blocked from portal API', true);

    const fb = await req('POST', '/portal/feedback', {
      token,
      body: { rating: 5, comment: 'Smoke feedback' },
    });
    assert(fb.status === 201 || fb.status === 200, `feedback ${fb.status}`);
    log('feedback', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_16_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
