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

describe('Phase 8 Work Orders (e2e)', () => {
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
    const tech = await prisma.user.findFirstOrThrow({
      where: { email: 'm.ahmed@promotors.eg' },
    });
    techUserId = tech.id;
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

  async function createApprovedQuoteWithWo() {
    const phone = `+20 184 ${String(Date.now()).slice(-7)}`;
    const plate = `و و ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `wo-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'WO Customer', nameAr: 'عميل أمر شغل', phone },
        newVehicle: {
          make: 'Nissan',
          model: 'Sunny',
          year: 2020,
          plate,
        },
        mileage: 55000,
        fuelLevelPct: 45,
        complaint: 'Engine noise',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 10 * 3600_000).toISOString(),
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
            nameEn: 'Belt replacement',
            nameAr: 'استبدال السير',
            qty: 1,
            unitPrice: 800,
          },
          {
            kind: 'part',
            nameEn: 'Drive belt',
            nameAr: 'سير',
            qty: 1,
            unitPrice: 350,
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
      .send({ comment: 'OK' })
      .expect(200);

    const body = approved.body as {
      data: {
        workOrder: {
          id: string;
          number: string;
          status: string;
          tasks: Array<{ title: string }>;
        };
        visitStatus: string;
      };
    };
    return {
      visitId,
      quoteId,
      workOrder: body.data.workOrder,
    };
  }

  it('approve creates WO with WO-YYYY-#### and labor tasks', async () => {
    const { workOrder, visitId } = await createApprovedQuoteWithWo();
    expect(workOrder.status).toBe('draft');
    expect(workOrder.number).toMatch(/^WO-\d{4}-\d{4,}$/);
    expect(workOrder.tasks.some((t) => t.title === 'Belt replacement')).toBe(
      true,
    );

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('readyForRepair');

    const createdEvent = await prisma.outboxEvent.findFirst({
      where: { eventType: 'workorder.created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(createdEvent).toBeTruthy();
  });

  it('assign → start moves visit to inProgress', async () => {
    const { workOrder } = await createApprovedQuoteWithWo();

    const assigned = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ technicianId: techUserId })
      .expect(200);
    expect((assigned.body as { data: { status: string } }).data.status).toBe(
      'assigned',
    );

    const started = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const startedBody = started.body as {
      data: { status: string; visitStatus: string; technician: string | null };
    };
    expect(startedBody.data.status).toBe('in_progress');
    expect(startedBody.data.visitStatus).toBe('inProgress');
    expect(startedBody.data.technician).toBeTruthy();
  });

  it('blocks start while visit is waitingApproval', async () => {
    const phone = `+20 185 ${String(Date.now()).slice(-7)}`;
    const plate = `ب ب ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `wo-block-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Block Start', nameAr: 'منع', phone },
        newVehicle: {
          make: 'Kia',
          model: 'Cerato',
          year: 2019,
          plate,
        },
        mileage: 70000,
        fuelLevelPct: 30,
        complaint: 'AC',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      })
      .expect(201);
    const visitId = (checkin.body as { data: { id: string } }).data.id;

    await prisma.vehicleVisit.update({
      where: { id: visitId },
      data: { status: 'waitingApproval' },
    });

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
      include: { jobTicket: true },
    });

    const year = new Date().getFullYear();
    const wo = await prisma.workOrder.create({
      data: {
        organizationId: visit.organizationId,
        branchId: visit.branchId,
        visitId,
        jobTicketId: visit.jobTicket!.id,
        number: `WO-${year}-9${String(Date.now()).slice(-6)}${randomUUID().slice(0, 4)}`,
        status: 'assigned',
        technicianId: techUserId,
        createdBy: techUserId,
        tasks: {
          create: [{ title: 'Temp', status: 'assigned', sortOrder: 0 }],
        },
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${wo.id}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('send-to-qc completes tasks and moves visit to qualityCheck', async () => {
    const { workOrder } = await createApprovedQuoteWithWo();

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

    const qcBlocked = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/send-to-qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(409);
    expect((qcBlocked.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const qc = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/send-to-qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const body = qc.body as {
      data: {
        status: string;
        visitStatus: string;
        qualityCheckId: string | null;
        tasksCompleted: number;
        tasksTotal: number;
      };
    };
    expect(body.data.status).toBe('qc');
    expect(body.data.visitStatus).toBe('qualityCheck');
    expect(body.data.qualityCheckId).toBeTruthy();
    expect(body.data.tasksCompleted).toBe(body.data.tasksTotal);

    const list = await request(app.getHttpServer())
      .get('/api/v1/work-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .query({ status: 'qc' })
      .expect(200);
    const rows = (
      list.body as {
        data: Array<{ id: string; ticket: string; customer: string }>;
      }
    ).data;
    expect(rows.some((r) => r.id === workOrder.id)).toBe(true);
    const row = rows.find((r) => r.id === workOrder.id)!;
    expect(row.ticket).toMatch(/^JT-/);
    expect(row.customer).toBeTruthy();
  });

  it('pause / cancel enforce state machine', async () => {
    const { workOrder } = await createApprovedQuoteWithWo();

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/pause`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(409);

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

    const paused = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/pause`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((paused.body as { data: { status: string } }).data.status).toBe(
      'paused',
    );

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrder.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ reason: 'Customer left' })
      .expect(200);
    expect((cancelled.body as { data: { status: string } }).data.status).toBe(
      'cancelled',
    );
  });
});
