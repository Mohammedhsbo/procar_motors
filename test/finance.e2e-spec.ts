import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 13 Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let advisorToken: string;
  let accountantToken: string;
  let techToken: string;
  let techUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    advisorToken = (await login('mostafa@promotors.eg')).data.accessToken;
    accountantToken = (await login('rania@promotors.eg')).data.accessToken;
    techToken = (await login('m.ahmed@promotors.eg')).data.accessToken;
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

  async function createApprovedQuote() {
    const phone = `+20 193 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `م و ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `fin-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Finance Cust', nameAr: 'عميل مالية', phone },
        newVehicle: { make: 'Kia', model: 'Cerato', year: 2021, plate },
        mileage: 22000,
        fuelLevelPct: 50,
        complaint: 'Finance test',
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
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          {
            kind: 'labor',
            nameEn: 'Finance Labor',
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
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const workOrderId = (
      approved.body as { data: { workOrder: { id: string } } }
    ).data.workOrder.id;
    return { visitId, quoteId, workOrderId };
  }

  async function advanceToReadyForDelivery(
    visitId: string,
    workOrderId: string,
  ) {
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
    const qcId = qcBody.data.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/quality-checks/${qcId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        items: qcBody.data.items.map((i) => ({ id: i.id, passed: true })),
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcId}/pass`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  }

  it('RBAC: technician cannot create invoices', async () => {
    const { quoteId } = await createApprovedQuote();
    await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .send({ quotationId: quoteId })
      .expect(403);
  });

  it('invoice from quote → issue → partial pay → pay → deliver', async () => {
    const { visitId, quoteId, workOrderId } = await createApprovedQuote();

    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `inv-${randomUUID()}`)
      .send({ quotationId: quoteId })
      .expect(201);
    const invoice = (
      inv.body as {
        data: {
          id: string;
          number: string;
          status: string;
          total: number;
          items: unknown[];
        };
      }
    ).data;
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{4,}$/);
    expect(invoice.status).toBe('draft');
    expect(invoice.items.length).toBeGreaterThan(0);
    expect(invoice.total).toBe(1140);

    // Lines immutable after issue — cancel before issue works; duplicate blocked
    await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .send({ quotationId: quoteId })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/issue`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const partial = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `pay-${randomUUID()}`)
      .send({ amount: 400, method: 'cash' })
      .expect(200);
    expect((partial.body as { data: { status: string } }).data.status).toBe(
      'partial',
    );
    expect(
      (partial.body as { data: { amountPaid: number } }).data.amountPaid,
    ).toBe(400);

    // Overpay rejected
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .send({ amount: 99999, method: 'card' })
      .expect(409);

    await advanceToReadyForDelivery(visitId, workOrderId);

    const visit = await prisma.vehicleVisit.findFirstOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('readyForDelivery');

    // Deliver blocked without full payment
    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/deliver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ version: visit.version })
      .expect(409);
    expect((blocked.body as { error: { code: string } }).error.code).toBe(
      'PAYMENT_REQUIRED',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `pay-${randomUUID()}`)
      .send({ amount: 740, method: 'visa' })
      .expect(200);

    const paid = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoice.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((paid.body as { data: { status: string } }).data.status).toBe(
      'paid',
    );

    const fresh = await prisma.vehicleVisit.findFirstOrThrow({
      where: { id: visitId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/deliver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ version: fresh.version })
      .expect(200);

    const done = await prisma.vehicleVisit.findFirstOrThrow({
      where: { id: visitId },
    });
    expect(done.status).toBe('completed');
    expect(done.deliveredAt).toBeTruthy();

    const payments = await request(app.getHttpServer())
      .get(`/api/v1/payments?invoiceId=${invoice.id}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect(
      (payments.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('manager payment override delivers with audit', async () => {
    const { visitId, quoteId, workOrderId } = await createApprovedQuote();
    const inv = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .send({ quotationId: quoteId })
      .expect(201);
    const invoiceId = (inv.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    await advanceToReadyForDelivery(visitId, workOrderId);
    const visit = await prisma.vehicleVisit.findFirstOrThrow({
      where: { id: visitId },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/deliver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        version: visit.version,
        overridePayment: true,
        overrideReason: 'VIP credit approval',
      })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: visitId,
        action: 'visit.deliver.payment_override',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('lists taxes and creates expenses', async () => {
    const taxes = await request(app.getHttpServer())
      .get('/api/v1/taxes')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect(
      (taxes.body as { data: Array<{ rate: number }> }).data.length,
    ).toBeGreaterThan(0);

    const exp = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Branch-Id', b1)
      .send({
        category: 'utilities',
        amount: 250,
        expenseDate: '2026-08-11',
        notes: 'Water bill',
      })
      .expect(201);
    expect((exp.body as { data: { amount: number } }).data.amount).toBe(250);
  });

  it('PO approve requires pending_approval (Phase 12 lock)', async () => {
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { nameEn: 'AutoParts Egypt' },
    });
    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'FLT-0921' },
    });
    const officer = (await login('hany@promotors.eg')).data.accessToken;
    const manager = (await login('mona@promotors.eg')).data.accessToken;

    const pr = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${officer}`)
      .set('X-Branch-Id', b1)
      .send({ items: [{ partId: part.id, qty: 1 }] })
      .expect(201);
    const prId = (pr.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${officer}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${manager}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const po = await request(app.getHttpServer())
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${officer}`)
      .set('X-Branch-Id', b1)
      .send({
        supplierId: supplier.id,
        purchaseRequestId: prId,
        // no autoSubmit — stays new
      })
      .expect(201);
    const poId = (po.body as { data: { id: string; status: string } }).data.id;
    expect((po.body as { data: { status: string } }).data.status).toBe('new');

    const denied = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${manager}`)
      .set('X-Branch-Id', b1)
      .expect(409);
    expect((denied.body as { error: { code: string } }).error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/submit`)
      .set('Authorization', `Bearer ${officer}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${manager}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });
});
