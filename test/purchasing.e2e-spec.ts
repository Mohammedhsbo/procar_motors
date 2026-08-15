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

describe('Phase 12 Purchasing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let officerToken: string;
  let managerToken: string;
  let storeToken: string;
  let techToken: string;
  let adminToken: string;
  let advisorToken: string;
  let supplierId: string;
  let partId: string;

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
    officerToken = (await login('hany@promotors.eg')).data.accessToken;
    managerToken = (await login('mona@promotors.eg')).data.accessToken;
    storeToken = (await login('sayed@promotors.eg')).data.accessToken;
    techToken = (await login('m.ahmed@promotors.eg')).data.accessToken;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    advisorToken = (await login('mostafa@promotors.eg')).data.accessToken;

    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { nameEn: 'AutoParts Egypt' },
    });
    supplierId = supplier.id;
    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'BAT-70A' },
    });
    partId = part.id;
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

  it('RBAC: technician cannot create purchase requests', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .send({
        items: [{ partId, qty: 1 }],
      })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('PR → approve → PO → approve → partial + full GRN increases stock', async () => {
    const warehouse = await prisma.warehouse.findFirstOrThrow({
      where: { branchId: b1, isDefault: true },
    });
    const beforeBal = await prisma.stockBalance.findFirstOrThrow({
      where: { partId, warehouseId: warehouse.id },
    });

    const prRes = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `pr-${randomUUID()}`)
      .send({
        reason: 'Restock battery',
        items: [{ partId, qty: 5 }],
      })
      .expect(201);
    const prId = (prRes.body as { data: { id: string; number: string } }).data
      .id;
    expect((prRes.body as { data: { number: string } }).data.number).toMatch(
      /^PR-\d{4}-\d{4,}$/,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    // Officer cannot approve
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const poRes = await request(app.getHttpServer())
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `po-${randomUUID()}`)
      .send({
        supplierId,
        purchaseRequestId: prId,
        autoSubmit: true,
      })
      .expect(201);
    const po = (
      poRes.body as {
        data: {
          id: string;
          number: string;
          status: string;
          items: Array<{ id: string; qtyOrdered: number }>;
          total: number;
        };
      }
    ).data;
    expect(po.number).toMatch(/^PO-\d{4}-\d{4,}$/);
    expect(po.status).toBe('pending_approval');
    expect(po.total).toBeGreaterThan(0);

    // Duplicate PO from same PR rejected
    await request(app.getHttpServer())
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .send({ supplierId, purchaseRequestId: prId })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${po.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const poItemId = po.items[0].id;

    // Partial receive 2 of 5
    const grn1 = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({
        poId: po.id,
        supplierInvoiceRef: 'INV-SUP-001',
        items: [{ poItemId, qtyReceived: 2 }],
      })
      .expect(201);
    const grn1Id = (grn1.body as { data: { id: string } }).data.id;

    const receiveKey = `recv-${randomUUID()}`;
    const received1 = await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${grn1Id}/receive`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', receiveKey)
      .expect(200);
    expect((received1.body as { data: { status: string } }).data.status).toBe(
      'received',
    );

    // Idempotent receive replay
    await request(app.getHttpServer())
      .post(`/api/v1/goods-receipts/${grn1Id}/receive`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', receiveKey)
      .expect(200);

    const midPo = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${po.id}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((midPo.body as { data: { status: string } }).data.status).toBe(
      'partially_received',
    );

    const midBal = await prisma.stockBalance.findFirstOrThrow({
      where: { partId, warehouseId: warehouse.id },
    });
    expect(Number(midBal.onHand)).toBe(Number(beforeBal.onHand) + 2);

    // Remaining 3
    const grn2 = await request(app.getHttpServer())
      .post('/api/v1/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({
        poId: po.id,
        items: [{ poItemId, qtyReceived: 3 }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/goods-receipts/${(grn2.body as { data: { id: string } }).data.id}/receive`,
      )
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `recv-${randomUUID()}`)
      .expect(200);

    const finalPo = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${po.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((finalPo.body as { data: { status: string } }).data.status).toBe(
      'received',
    );

    const afterBal = await prisma.stockBalance.findFirstOrThrow({
      where: { partId, warehouseId: warehouse.id },
    });
    expect(Number(afterBal.onHand)).toBe(Number(beforeBal.onHand) + 5);

    const txn = await prisma.inventoryTransaction.findFirst({
      where: { partId, type: 'purchase_in' },
      orderBy: { createdAt: 'desc' },
    });
    expect(txn).toBeTruthy();
  });

  it('reject PR and cancel PO before receive', async () => {
    const pr = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .send({ items: [{ partId, qty: 1 }] })
      .expect(201);
    const prId = (pr.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/submit`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${prId}/reject`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'Not needed' })
      .expect(200);

    const pr2 = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .send({ items: [{ partId, qty: 2 }] })
      .expect(201);
    const pr2Id = (pr2.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${pr2Id}/submit`)
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-requests/${pr2Id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const po = await request(app.getHttpServer())
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .send({ supplierId, purchaseRequestId: pr2Id })
      .expect(201);
    const poId = (po.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/cancel`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'Supplier delay' })
      .expect(200);
  });

  it('unavailable-part → from-unavailable procurement flow (idempotent)', async () => {
    // Force unavailable by reserving almost all OIL stock then approving huge qty
    const oil = await prisma.part.findFirstOrThrow({
      where: { sku: 'OIL-5W30' },
    });
    const phone = `+20 188 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ش ر ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p12-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'P12 Cust', nameAr: 'عميل', phone },
        newVehicle: { make: 'Nissan', model: 'Sunny', year: 2019, plate },
        mileage: 60000,
        fuelLevelPct: 30,
        complaint: 'Oil',
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

    const quote = await request(app.getHttpServer())
      .post('/api/v1/quotations')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          {
            kind: 'part',
            partId: oil.id,
            nameEn: oil.nameEn,
            nameAr: oil.nameAr,
            qty: 99999,
            unitPrice: Number(oil.sellPrice),
          },
        ],
      })
      .expect(201);
    const quoteId = (quote.body as { data: { id: string } }).data.id;
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
    const hook = (
      approved.body as {
        data: {
          workOrder: { id: string };
          hooks: {
            partReservation: {
              unavailable: Array<{ partId: string; qty: number }>;
              deferred_purchase: Array<{ hook: string; endpoint?: string }>;
            };
          };
        };
      }
    ).data;
    expect(hook.hooks.partReservation.unavailable.length).toBeGreaterThan(0);
    expect(hook.hooks.partReservation.deferred_purchase[0].hook).toBe(
      'deferred_to_phase_12',
    );

    const key = `unavail-${quoteId}`;
    const pr1 = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/from-unavailable')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', key)
      .send({
        quotationId: quoteId,
        visitId,
        workOrderId: hook.workOrder.id,
        items: hook.hooks.partReservation.unavailable.map((u) => ({
          partId: u.partId,
          qty: u.qty,
        })),
      })
      .expect(201);
    const prId = (pr1.body as { data: { id: string; status: string } }).data.id;
    expect((pr1.body as { data: { status: string } }).data.status).toBe(
      'pending_approval',
    );

    // Same quotation returns existing open PR
    const pr2 = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/from-unavailable')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .send({
        quotationId: quoteId,
        items: [{ partId: oil.id, qty: 1 }],
      })
      .expect(201);
    expect((pr2.body as { data: { id: string } }).data.id).toBe(prId);

    // Idempotent key replay (same payload)
    const replay = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/from-unavailable')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', key)
      .send({
        quotationId: quoteId,
        visitId,
        workOrderId: hook.workOrder.id,
        items: hook.hooks.partReservation.unavailable.map((u) => ({
          partId: u.partId,
          qty: u.qty,
        })),
      });
    expect([200, 201]).toContain(replay.status);
    if (replay.status === 201 || replay.status === 200) {
      expect((replay.body as { data: { id: string } }).data.id).toBe(prId);
    }
  });

  it('lists suppliers with bilingual fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/suppliers')
      .set('Authorization', `Bearer ${officerToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const row = (
      res.body as { data: Array<{ nameEn: string; nameAr: string }> }
    ).data.find((s) => s.nameEn === 'AutoParts Egypt');
    expect(row?.nameAr).toBeTruthy();
  });
});
