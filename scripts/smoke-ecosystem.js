/**
 * Phase 18 live smoke — ecosystem stubs + outbox bus
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1';

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
    const login = await req('POST', '/auth/login', {
      body: { email: 'nourhan@promotors.eg', password: 'Password123!' },
    });
    assert(login.status === 201, `login ${login.status}`);
    const token = login.json.data.accessToken;

    for (const path of ['/uxp/health', '/tireszone/health', '/daily-cafe/health']) {
      const res = await req('GET', path, { token });
      assert(res.status === 200, `${path} ${res.status}`);
      assert(res.json.data.status === 'stub', `${path} not stub`);
      log(path, true);
    }

    const unauth = await req('GET', '/uxp/health');
    assert(unauth.status === 401, `unauth ${unauth.status}`);
    log('unauthenticated blocked', true);

    const otp = await req('POST', '/portal/auth/request-otp', {
      body: { phone: '+20 100 214 8890' },
    });
    const verify = await req('POST', '/portal/auth/verify-otp', {
      body: { phone: '+20 100 214 8890', code: otp.json.data.devCode },
    });
    const portal = await req('GET', '/uxp/health', {
      token: verify.json.data.accessToken,
    });
    assert(portal.status === 403, `portal ${portal.status}`);
    log('customer blocked from ecosystem', true);

    const drain = await req('POST', '/jobs/run/outbox-drain', {
      token: (
        await req('POST', '/auth/login', {
          body: { email: 'kareem@promotors.eg', password: 'Password123!' },
        })
      ).json.data.accessToken,
    });
    assert(drain.status === 200, `outbox-drain ${drain.status} ${JSON.stringify(drain.json)}`);
    log('outbox drain', true);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_18_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
