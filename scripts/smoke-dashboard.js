/**
 * Phase 15 live smoke — dashboard KPIs + reports + export
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
    const admin = await req('POST', '/auth/login', {
      body: { email: 'kareem@promotors.eg', password: 'Password123!' },
    });
    assert(admin.status === 201, `admin ${admin.status}`);
    const token = admin.json.data.accessToken;
    const b1 =
      admin.json.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      admin.json.data.user.branchIds[0];

    const summary = await req('GET', '/dashboard/summary', {
      token,
      branchId: b1,
    });
    assert(summary.status === 200, `summary ${summary.status}`);
    const kpis = summary.json.data.kpis;
    assert(kpis.vehiclesToday && kpis.activeJobs && kpis.revenueToday, 'kpi keys');
    log('dashboard summary', true, `vehiclesToday=${kpis.vehiclesToday.value}`);

    for (const p of [
      '/dashboard/revenue-overview',
      '/dashboard/workshop-status',
      '/dashboard/monthly-revenue',
      '/dashboard/tech-productivity',
      '/dashboard/recent-activities',
    ]) {
      const r = await req('GET', p, { token, branchId: b1 });
      assert(r.status === 200, `${p} ${r.status}`);
      log(p, true);
    }

    for (const p of [
      '/reports/workshop',
      '/reports/financial',
      '/reports/inventory',
      '/reports/technician-performance',
      '/reports/analytics',
    ]) {
      const r = await req('GET', p, { token, branchId: b1 });
      assert(r.status === 200, `${p} ${r.status}`);
      log(p, true);
    }

    const exp = await req('POST', '/reports/export', {
      token,
      branchId: b1,
      body: { kind: 'financial', format: 'csv' },
    });
    assert(exp.status === 201 || exp.status === 200, `export ${exp.status}`);
    const jobId = exp.json.data.jobId;
    let status = 'queued';
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      const poll = await req('GET', `/reports/export/${jobId}`, {
        token,
        branchId: b1,
      });
      status = poll.json.data?.status;
      if (status === 'completed' || status === 'failed') break;
    }
    assert(status === 'completed', `export status ${status}`);
    log('report export csv', true, jobId);

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- SMOKE SUMMARY ---');
    console.log(
      `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`,
    );
    if (failed.length) process.exit(1);
    console.log('PHASE_15_SMOKE_OK');
  } catch (e) {
    console.error('SMOKE FATAL:', e.message);
    process.exit(1);
  }
})();
