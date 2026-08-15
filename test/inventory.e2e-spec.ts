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

describe('Phase 11 Inventory (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let storeToken: string;
  let advisorToken: string;
  let partId: string;
  let workOrderId: string;

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
    storeToken = (await login('sayed@promotors.eg')).data.accessToken;
    advisorToken = (await login('mostafa@promotors.eg')).data.accessToken;

    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'BRK-1042' },
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

  async function createWo() {
    const phone = `+20 195 ${String(Date.now()).slice(-7)}`;
    const plate = `ق ق ${String(Date.now()).slice(-4)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `inv-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Inv Cust', nameAr: 'مخزن', phone },
        newVehicle: {
          make: 'Toyota',
          model: 'Corolla',
          year: 2023,
          plate,
        },
        mileage: 10000,
        fuelLevelPct: 50,
        complaint: 'brakes',
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
            kind: 'part',
            nameEn: 'Front Brake Pads – Toyota',
            nameAr: 'تيل',
            qty: 2,
            unitPrice: 950,
            partId,
          },
          {
            kind: 'labor',
            nameEn: 'Brake job',
            nameAr: 'فرامل',
            qty: 1,
            unitPrice: 400,
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
    const body = approved.body as {
      data: {
        workOrder: { id: string };
        hooks: {
          partReservation: {
            reserved: Array<{ reservationId: string; qty: number }>;
          };
        };
      };
    };
    expect(body.data.hooks.partReservation.reserved.length).toBe(1);
    workOrderId = body.data.workOrder.id;
    return {
      workOrderId,
      reservationId: body.data.hooks.partReservation.reserved[0].reservationId,
    };
  }

  it('lists parts with available/reserved FE fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/parts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const rows = (
      res.body as {
        data: Array<{
          sku: string;
          available: number;
          reserved: number;
          min: number;
          buy: number;
          sell: number;
        }>;
      }
    ).data;
    const brk = rows.find((r) => r.sku === 'BRK-1042');
    expect(brk).toBeTruthy();
    expect(brk!.available).toBeGreaterThanOrEqual(0);
    expect(brk!.buy).toBe(620);
    expect(brk!.sell).toBe(950);
  });

  it('approve auto-reserves part lines; release restores available', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/inventory/balances')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .query({ q: 'BRK-1042' })
      .expect(200);
    const beforeRow = (
      before.body as { data: Array<{ available: number; reserved: number }> }
    ).data[0];

    const { reservationId } = await createWo();

    const mid = await request(app.getHttpServer())
      .get('/api/v1/inventory/balances')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .query({ q: 'BRK-1042' })
      .expect(200);
    const midRow = (
      mid.body as { data: Array<{ available: number; reserved: number }> }
    ).data[0];
    expect(midRow.reserved).toBe(beforeRow.reserved + 2);
    expect(midRow.available).toBe(beforeRow.available - 2);

    await request(app.getHttpServer())
      .post(`/api/v1/inventory/reservations/${reservationId}/release`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({})
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/v1/inventory/balances')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .query({ q: 'BRK-1042' })
      .expect(200);
    const afterRow = (
      after.body as { data: Array<{ available: number; reserved: number }> }
    ).data[0];
    expect(afterRow.available).toBe(beforeRow.available);
    expect(afterRow.reserved).toBe(beforeRow.reserved);
  });

  it('consume reduces onHand and reserved; return restores onHand', async () => {
    const { reservationId, workOrderId: woId } = await createWo();

    const before = await prisma.stockBalance.findFirstOrThrow({
      where: { partId },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/inventory/reservations/${reservationId}/consume`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `consume-${randomUUID()}`)
      .send({})
      .expect(200);

    const mid = await prisma.stockBalance.findFirstOrThrow({
      where: { partId },
    });
    expect(Number(mid.onHand)).toBe(Number(before.onHand) - 2);
    expect(Number(mid.reserved)).toBe(Number(before.reserved) - 2);

    await request(app.getHttpServer())
      .post('/api/v1/inventory/returns')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({ partId, qty: 1, workOrderId: woId })
      .expect(201);

    const after = await prisma.stockBalance.findFirstOrThrow({
      where: { partId },
    });
    expect(Number(after.onHand)).toBe(Number(mid.onHand) + 1);
  });

  it('rejects insufficient stock', async () => {
    const { workOrderId: woId } = await createWo();
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/reservations')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('X-Branch-Id', b1)
      .send({ partId, workOrderId: woId, qty: 99999 })
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'INSUFFICIENT_STOCK',
    );
  });

  it('handles concurrent reserves without negative stock', async () => {
    const part = await prisma.part.findFirstOrThrow({
      where: { sku: 'FLT-0921' },
    });
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { partId: part.id },
    });
    // reset known stock for concurrency
    await prisma.stockBalance.update({
      where: { id: balance.id },
      data: { onHand: 20, reserved: 0, version: { increment: 1 } },
    });

    const phone = `+20 196 ${String(Date.now()).slice(-7)}`;
    const plate = `ر ر ${String(Date.now()).slice(-4)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `conc-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Conc', nameAr: 'تزامن', phone },
        newVehicle: {
          make: 'Honda',
          model: 'City',
          year: 2020,
          plate,
        },
        mileage: 1,
        fuelLevelPct: 10,
        complaint: 'x',
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
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          {
            kind: 'labor',
            nameEn: 'L',
            nameAr: 'ع',
            qty: 1,
            unitPrice: 1,
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
    const woId = (approved.body as { data: { workOrder: { id: string } } }).data
      .workOrder.id;

    const attempts = Array.from({ length: 30 }, () =>
      request(app.getHttpServer())
        .post('/api/v1/inventory/reservations')
        .set('Authorization', `Bearer ${storeToken}`)
        .set('X-Branch-Id', b1)
        .send({ partId: part.id, workOrderId: woId, qty: 1 }),
    );
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.status === 201).length;
    const fail = results.filter((r) => r.status === 409).length;
    expect(ok + fail).toBe(30);
    expect(ok).toBeLessThanOrEqual(20);

    const final = await prisma.stockBalance.findFirstOrThrow({
      where: { partId: part.id },
    });
    expect(Number(final.onHand)).toBe(20);
    expect(Number(final.reserved)).toBe(ok);
    expect(Number(final.reserved)).toBeLessThanOrEqual(Number(final.onHand));
    expect(
      Number(final.onHand) - Number(final.reserved),
    ).toBeGreaterThanOrEqual(0);
  });
});
