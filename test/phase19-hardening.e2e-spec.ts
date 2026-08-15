import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 19 hardening (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let b2: string;
  let adminToken: string;
  let receptionToken: string;
  let techToken: string;
  let storeToken: string;
  let accountantToken: string;
  let techUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, {
      corsOrigins: ['http://localhost:5173'],
      nodeEnv: 'test',
    });
    await app.init();

    prisma = app.get(PrismaService);
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    b2 = branches.find((b) => b.code === 'b2')!.id;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    receptionToken = (await login('nourhan@promotors.eg')).data.accessToken;
    techToken = (await login('m.ahmed@promotors.eg')).data.accessToken;
    storeToken = (await login('sayed@promotors.eg')).data.accessToken;
    accountantToken = (await login('rania@promotors.eg')).data.accessToken;
    techUserId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'm.ahmed@promotors.eg' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    return res.body as LoginBody;
  }

  it('sets helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
  });

  it('does not leak stack traces on 500-class filter mapping', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/vehicle-visits/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1);
    const body = res.body as {
      success: boolean;
      error?: { stack?: string };
    };
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/at\s+\w+\s+\(/);
    expect(body.error).not.toHaveProperty('stack');
  });

  it('RBAC: technician cannot check in; reception cannot consume stock', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p19-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'Nope',
          nameAr: 'لا',
          phone: `+20 199 ${randomUUID().replace(/-/g, '').slice(0, 7)}`,
        },
        newVehicle: {
          make: 'Fiat',
          model: 'Tipo',
          year: 2018,
          plate: `ر ب ${randomUUID().replace(/-/g, '').slice(0, 6)}`,
        },
        mileage: 1,
        fuelLevelPct: 10,
        complaint: 'x',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/inventory/reservations/${randomUUID()}/consume`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/inventory/summary')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });

  it('blocks cross-branch access for reception', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/vehicle-visits')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b2)
      .expect(403);
  });

  it('blocks customer portal tokens from staff APIs', async () => {
    const otp = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/request-otp')
      .send({ phone: '+20 100 214 8890' });
    const code = (otp.body as { data?: { devCode?: string } }).data?.devCode;
    if (!code) return;
    const verify = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/verify-otp')
      .send({ phone: '+20 100 214 8890', code });
    const token = (verify.body as { data?: { accessToken?: string } }).data
      ?.accessToken;
    if (!token) return;
    await request(app.getHttpServer())
      .get('/api/v1/vehicle-visits')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Branch-Id', b1)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `p19-${randomUUID()}`,
        operations: [
          {
            operationId: randomUUID(),
            entityType: 'customer',
            action: 'create',
            clientTimestamp: new Date().toISOString(),
            payload: { nameEn: 'X', nameAr: 'س', phone: '+20 100 000 0001' },
          },
        ],
      })
      .expect(403);
  });

  it('inventory summary/transactions/alerts/adjust are reachable', async () => {
    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'BRK-1042' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/inventory/summary')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/inventory/transactions')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/inventory/alerts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ partId: part.id, qtyDelta: 1, notes: 'phase19 coverage' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/job-tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });

  it('50 parallel consumes never go negative', async () => {
    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'FLT-0921' },
    });
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { partId: part.id },
    });
    await prisma.stockBalance.update({
      where: { id: balance.id },
      data: { onHand: 50, reserved: 0, version: { increment: 1 } },
    });

    const phone = `+20 191 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ح ص ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p19c-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Conc50', nameAr: 'تزامن', phone },
        newVehicle: { make: 'Fiat', model: '500', year: 2020, plate },
        mileage: 1,
        fuelLevelPct: 10,
        complaint: 'c',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      })
      .expect(201);
    const visitId = (checkin.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'inspection', version: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'waitingApproval', version: 2 })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/api/v1/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          { kind: 'labor', nameEn: 'L', nameAr: 'ع', qty: 1, unitPrice: 1 },
        ],
      })
      .expect(201);
    const quoteId = (created.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const woId = (approved.body as { data: { workOrder: { id: string } } }).data
      .workOrder.id;

    const reserved = await request(app.getHttpServer())
      .post('/api/v1/inventory/reservations')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({ partId: part.id, workOrderId: woId, qty: 50 })
      .expect(201);
    const reservationId = (reserved.body as { data: { id: string } }).data.id;

    const attempts = Array.from({ length: 50 }, () =>
      request(app.getHttpServer())
        .post(`/api/v1/inventory/reservations/${reservationId}/consume`)
        .set('Authorization', `Bearer ${storeToken}`)
        .set('X-Branch-Id', b1)
        .send({ qty: 1 }),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status >= 400).length;
    expect(ok + rejected).toBe(50);
    expect(ok).toBe(50);

    await request(app.getHttpServer())
      .get('/api/v1/inventory/reservations')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const draftInv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ quotationId: quoteId })
      .expect(201);
    const draftId = (draftInv.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${draftId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'phase19 coverage' })
      .expect(200);

    const final = await prisma.stockBalance.findFirstOrThrow({
      where: { partId: part.id },
    });
    expect(Number(final.onHand)).toBe(0);
    expect(Number(final.reserved)).toBe(0);
    expect(Number(final.onHand)).toBeGreaterThanOrEqual(0);
    expect(Number(final.reserved)).toBeGreaterThanOrEqual(0);
  });

  it('full workshop workflow reaches paid invoice', async () => {
    const phone = `+20 192 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ك م ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p19w-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Flow', nameAr: 'تدفق', phone },
        newVehicle: { make: 'Kia', model: 'Rio', year: 2021, plate },
        mileage: 1000,
        fuelLevelPct: 40,
        complaint: 'flow',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      })
      .expect(201);
    const visitId = (checkin.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'inspection', version: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'waitingApproval', version: 2 })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/api/v1/quotations')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          {
            kind: 'labor',
            nameEn: 'Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 1000,
          },
        ],
      })
      .expect(201);
    const quoteId = (created.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/send`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const workOrderId = (
      approved.body as { data: { workOrder: { id: string } } }
    ).data.workOrder.id;

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ technicianId: techUserId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/start`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const wo = await prisma.workOrder.findFirstOrThrow({
      where: { id: workOrderId },
      include: { tasks: true },
    });
    for (const t of wo.tasks) {
      if (t.status !== 'completed') {
        await prisma.technicianTask.update({
          where: { id: t.id },
          data: { status: 'completed', completedAt: new Date() },
        });
      }
    }
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/send-to-qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const qc = await request(app.getHttpServer())
      .post('/api/v1/quality-checks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ visitId, workOrderId })
      .expect(201);
    const qcBody = qc.body as {
      data: { id: string; items: Array<{ id: string }> };
    };
    await request(app.getHttpServer())
      .patch(`/api/v1/quality-checks/${qcBody.data.id}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        items: qcBody.data.items.map((item) => ({
          id: item.id,
          passed: true,
        })),
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcBody.data.id}/pass`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const invoice = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ quotationId: quoteId })
      .expect(201);
    const invoiceId = (invoice.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const paid = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p19p-${randomUUID()}`)
      .send({ method: 'cash', amount: 1140 })
      .expect(200);
    expect((paid.body as { data: { status: string } }).data.status).toBe(
      'paid',
    );
  });
});
