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

describe('Phase 10 Quality Control (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let advisorToken: string;
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

  async function createWoInQc() {
    const phone = `+20 192 ${String(Date.now()).slice(-7)}`;
    const plate = `ن ن ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `qc-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'QC Customer', nameAr: 'عميل جودة', phone },
        newVehicle: {
          make: 'BMW',
          model: 'X3',
          year: 2022,
          plate,
        },
        mileage: 30000,
        fuelLevelPct: 40,
        complaint: 'QC test',
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
            nameEn: 'QC Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 500,
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
    const workOrder = (
      approved.body as {
        data: { workOrder: { id: string; tasks: Array<{ id: string }> } };
      }
    ).data.workOrder;

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ technicianId: techUserId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/send-to-qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const qcId = (sent.body as { data: { qualityCheckId: string } }).data
      .qualityCheckId;
    return { visitId, workOrderId: workOrder.id, qcId };
  }

  it('blocks pass when checklist incomplete', async () => {
    const { qcId } = await createWoInQc();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcId}/pass`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('pass moves visit to readyForDelivery and completes WO', async () => {
    const { qcId, visitId, workOrderId } = await createWoInQc();
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/quality-checks/${qcId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const items = (detail.body as { data: { items: Array<{ id: string }> } })
      .data.items;
    expect(items).toHaveLength(7);

    await request(app.getHttpServer())
      .patch(`/api/v1/quality-checks/${qcId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ items: items.map((i) => ({ id: i.id, passed: true })) })
      .expect(200);

    const passed = await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcId}/pass`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const body = passed.body as {
      data: { status: string; visitStatus: string; workOrderStatus: string };
    };
    expect(body.data.status).toBe('passed');
    expect(body.data.visitStatus).toBe('readyForDelivery');
    expect(body.data.workOrderStatus).toBe('completed');

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('readyForDelivery');
    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
    });
    expect(wo.status).toBe('completed');

    const readyEvent = await prisma.outboxEvent.findFirst({
      where: { eventType: 'vehicle.ready' },
      orderBy: { createdAt: 'desc' },
    });
    expect(readyEvent).toBeTruthy();
  });

  it('fail creates rework and returns visit to inProgress', async () => {
    const { qcId, visitId, workOrderId } = await createWoInQc();

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/quality-checks/${qcId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const items = (detail.body as { data: { items: Array<{ id: string }> } })
      .data.items;

    // reason-only must fail
    const reasonOnly = await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcId}/fail`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'Brake noise remains' })
      .expect(409);
    expect((reasonOnly.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/quality-checks/${qcId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        items: [
          { id: items[0].id, passed: false },
          ...items.slice(1).map((i) => ({ id: i.id, passed: true })),
        ],
      })
      .expect(200);

    const failed = await request(app.getHttpServer())
      .post(`/api/v1/quality-checks/${qcId}/fail`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'Brake noise remains' })
      .expect(200);

    const body = failed.body as {
      data: {
        status: string;
        visitStatus: string;
        workOrderStatus: string;
        reworkTaskId: string;
      };
    };
    expect(body.data.status).toBe('failed');
    expect(body.data.visitStatus).toBe('inProgress');
    expect(body.data.workOrderStatus).toBe('in_progress');
    expect(body.data.reworkTaskId).toBeTruthy();

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('inProgress');
    const task = await prisma.technicianTask.findUniqueOrThrow({
      where: { id: body.data.reworkTaskId },
    });
    expect(task.workOrderId).toBe(workOrderId);
    expect(task.title).toContain('Rework');

    const failEvent = await prisma.outboxEvent.findFirst({
      where: { eventType: 'qc.failed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(failEvent).toBeTruthy();
  });

  it('blocks board transition to readyForDelivery without QC pass', async () => {
    const { visitId } = await createWoInQc();
    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visitId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'readyForDelivery', version: visit.version })
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'QC_REQUIRED',
    );
  });
});
