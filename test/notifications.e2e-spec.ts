import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';
import { OutboxDispatcherService } from '../src/infrastructure/jobs/outbox-dispatcher.service';
import { JobLockService } from '../src/infrastructure/jobs/job-lock.service';
import { LowStockScanService } from '../src/infrastructure/jobs/low-stock-scan.service';
import { QuotationsService } from '../src/modules/quotations/quotations.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 14 Notifications + Jobs (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcherService;
  let locks: JobLockService;
  let b1: string;
  let adminToken: string;
  let advisorToken: string;

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
    dispatcher = app.get(OutboxDispatcherService);
    locks = app.get(JobLockService);
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    advisorToken = (await login('mostafa@promotors.eg')).data.accessToken;
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

  it('creates notification on quotation.approved via outbox drain', async () => {
    const phone = `+20 195 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ن و ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `n14-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Notif Cust', nameAr: 'عميل', phone },
        newVehicle: { make: 'Honda', model: 'City', year: 2020, plate },
        mileage: 15000,
        fuelLevelPct: 40,
        complaint: 'Notify',
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
            nameEn: 'Notif Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 200,
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
    await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const outbox = await prisma.outboxEvent.findFirst({
      where: { eventType: 'quotation.approved', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    expect(outbox).toBeTruthy();

    const drain1 = await dispatcher.drain(100);
    expect(drain1.claimed).toBeGreaterThan(0);

    const list = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const rows = (
      list.body as {
        data: Array<{ titleEn: string; id: string; unread: boolean }>;
      }
    ).data;
    expect(rows.some((r) => r.titleEn.includes('approved'))).toBe(true);

    // Idempotent re-drain does not duplicate
    const beforeCount = await prisma.notification.count({
      where: { bodyEn: { contains: `outbox:${outbox!.id}` } },
    });
    await dispatcher.drain(100);
    const afterCount = await prisma.notification.count({
      where: { bodyEn: { contains: `outbox:${outbox!.id}` } },
    });
    expect(afterCount).toBe(beforeCount);

    const noteId = rows.find((r) => r.titleEn.includes('approved'))!.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${noteId}/read`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });

  it('preferences upsert and job locks prevent duplicate work', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notification-preferences')
      .set('Authorization', `Bearer ${advisorToken}`)
      .send({
        preferences: [
          {
            channel: 'in_app',
            eventKey: 'quotation.approved',
            enabled: true,
          },
        ],
      })
      .expect(200);

    const unlock1 = await locks.tryLock('test-lock-p14', 5_000);
    expect(unlock1).toBeTruthy();
    const unlock2 = await locks.tryLock('test-lock-p14', 5_000);
    expect(unlock2).toBeNull();
    await unlock1!();

    const unlock3 = await locks.tryLock('test-lock-p14', 5_000);
    expect(unlock3).toBeTruthy();
    await unlock3!();
  });

  it('quotation-expiry job marks overdue pending quotes', async () => {
    const phone = `+20 196 ${randomUUID().replace(/-/g, '').slice(0, 7)}`;
    const plate = `ق ق ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `exp-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Expire Cust', nameAr: 'عميل', phone },
        newVehicle: { make: 'Geely', model: 'Emgrand', year: 2019, plate },
        mileage: 40000,
        fuelLevelPct: 20,
        complaint: 'Expire',
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
            nameEn: 'Expire Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 100,
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

    await prisma.quotation.update({
      where: { id: quoteId },
      data: { validUntil: new Date(Date.now() - 60_000) },
    });

    // Deterministic service path first (worker may race on enqueue)
    const qs = app.get(QuotationsService);
    const expired = await qs.expireOverdue();
    expect(expired.expired).toBeGreaterThanOrEqual(1);

    const quote = await prisma.quotation.findFirstOrThrow({
      where: { id: quoteId },
    });
    expect(quote.status).toBe('expired');

    // Admin enqueue path still succeeds; second expire is idempotent
    const result = await request(app.getHttpServer())
      .post('/api/v1/jobs/run/quotation-expiry')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(result.body).toBeDefined();

    const again = await qs.expireOverdue();
    expect(again.expired).toBe(0);
  });

  it('low-stock-scan runs without error', async () => {
    const scan = await request(app.getHttpServer())
      .post('/api/v1/jobs/run/low-stock-scan')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(scan.body).toBeDefined();
    // Deterministic: call service
    const svc = app.get(LowStockScanService);
    const result = await svc.scan();
    expect(result.checked).toBeGreaterThan(0);
  });

  it('read-all notifications', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });
});
