import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';
import { QuotationsService } from '../src/modules/quotations/quotations.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 7 Quotations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let quotations: QuotationsService;
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
    quotations = app.get(QuotationsService);
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

  async function createPendingQuote() {
    const phone = `+20 183 ${String(Date.now()).slice(-7)}`;
    const plate = `ع ر ض ${String(Date.now()).slice(-4)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `q-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Quote Customer', nameAr: 'عميل عرض', phone },
        newVehicle: {
          make: 'Honda',
          model: 'Civic',
          year: 2021,
          plate,
        },
        mileage: 40000,
        fuelLevelPct: 40,
        complaint: 'Brakes',
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
            nameEn: 'Brake Pads',
            nameAr: 'تيل فرامل',
            qty: 1,
            unitPrice: 950,
          },
          {
            kind: 'labor',
            nameEn: 'Brake service',
            nameAr: 'خدمة فرامل',
            qty: 1,
            unitPrice: 900,
          },
        ],
      })
      .expect(201);

    const draft = (
      created.body as {
        data: { id: string; status: string; total: number; tax: number };
      }
    ).data;
    expect(draft.status).toBe('draft');
    expect(draft.tax).toBe(259); // (950+900)*0.14
    expect(draft.total).toBe(2109);

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${draft.id}/send`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    expect((sent.body as { data: { status: string } }).data.status).toBe(
      'pending',
    );
    return {
      visitId,
      quoteId: draft.id,
      number: (sent.body as { data: { number: string } }).data.number,
    };
  }

  it('approve moves visit to readyForRepair and writes approval', async () => {
    const { visitId, quoteId } = await createPendingQuote();

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ comment: 'Customer approved by phone' })
      .expect(200);

    const body = approved.body as {
      data: {
        status: string;
        visitStatus: string;
        approvals: Array<{ decision: string }>;
        workOrder: { id: string; number: string; status: string };
        hooks: {
          partReservation: {
            reserved: unknown[];
            unavailable: unknown[];
          };
        };
      };
    };
    expect(body.data.status).toBe('approved');
    expect(body.data.visitStatus).toBe('readyForRepair');
    expect(body.data.approvals[0]?.decision).toBe('approve');
    expect(body.data.workOrder.status).toBe('draft');
    expect(body.data.workOrder.number).toMatch(/^WO-\d{4}-\d{4,}$/);
    expect(body.data.hooks.partReservation).toBeDefined();
    expect(body.data.hooks.partReservation.reserved).toBeDefined();

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('readyForRepair');

    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: body.data.workOrder.id },
    });
    expect(wo.visitId).toBe(visitId);

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: 'quotation.approved' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).toBeTruthy();

    // approved immutable
    await request(app.getHttpServer())
      .patch(`/api/v1/quotations/${quoteId}/items`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        items: [
          {
            kind: 'labor',
            nameEn: 'X',
            nameAr: 'س',
            qty: 1,
            unitPrice: 1,
          },
        ],
      })
      .expect(409);
  });

  it('reject keeps visit waitingApproval; new-version works', async () => {
    const { visitId, quoteId } = await createPendingQuote();

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/reject`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ comment: 'Too expensive' })
      .expect(200);

    expect(
      (rejected.body as { data: { status: string; visitStatus: string } }).data
        .status,
    ).toBe('rejected');
    expect(
      (rejected.body as { data: { visitStatus: string } }).data.visitStatus,
    ).toBe('waitingApproval');

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('waitingApproval');

    const next = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/new-version`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(201);

    const v2 = (
      next.body as {
        data: { id: string; version: number; status: string; number: string };
      }
    ).data;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('draft');

    const old = await prisma.quotation.findUniqueOrThrow({
      where: { id: quoteId },
    });
    expect(old.status).toBe('superseded');
  });

  it('request-changes returns quote to draft', async () => {
    const { quoteId } = await createPendingQuote();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/request-changes`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ comment: 'Remove diagnostics line' })
      .expect(200);
    expect((res.body as { data: { status: string } }).data.status).toBe(
      'draft',
    );
  });

  it('rejects expired quotation approval', async () => {
    const { quoteId } = await createPendingQuote();
    await prisma.quotation.update({
      where: { id: quoteId },
      data: { validUntil: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({})
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'QUOTE_EXPIRED',
    );

    const expired = await quotations.expireOverdue();
    expect(expired.expired).toBeGreaterThanOrEqual(1);
    const row = await prisma.quotation.findUniqueOrThrow({
      where: { id: quoteId },
    });
    expect(row.status).toBe('expired');
  });
});
