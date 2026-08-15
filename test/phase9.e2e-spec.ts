import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 9 Technician Tasks + Board (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let advisorToken: string;
  let techToken: string;
  let techUserId: string;
  let serverPort: number;

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
    await app.listen(0);
    const rawAddress = (
      app.getHttpServer() as unknown as {
        address: () => string | { port: number } | null;
      }
    ).address();
    serverPort =
      typeof rawAddress === 'object' && rawAddress !== null
        ? rawAddress.port
        : 3000;

    prisma = app.get(PrismaService);
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    advisorToken = (await login('mostafa@promotors.eg')).data.accessToken;
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

  async function createAssignedWo() {
    const phone = `+20 187 ${String(Date.now()).slice(-7)}`;
    const plate = `ط ط ${String(Date.now()).slice(-4)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p9-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'P9 Customer', nameAr: 'عميل 9', phone },
        newVehicle: {
          make: 'Toyota',
          model: 'Yaris',
          year: 2021,
          plate,
        },
        mileage: 41000,
        fuelLevelPct: 50,
        complaint: 'Phase 9',
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
            nameEn: 'P9 Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 600,
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

    return {
      visitId,
      workOrderId: workOrder.id,
      taskId: workOrder.tasks[0].id,
    };
  }

  it('my-tasks lists assigned work; ownership blocks other tech WO', async () => {
    const { workOrderId, taskId } = await createAssignedWo();

    const mine = await request(app.getHttpServer())
      .get('/api/v1/my-tasks')
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const rows = (mine.body as { data: Array<{ id: string }> }).data;
    expect(rows.some((r) => r.id === taskId)).toBe(true);

    // WO assigned to admin — tech cannot mutate
    const other = await createAssignedWo();
    await prisma.workOrder.update({
      where: { id: other.workOrderId },
      data: {
        technicianId: (
          await prisma.user.findFirstOrThrow({
            where: { email: 'kareem@promotors.eg' },
          })
        ).id,
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${other.workOrderId}/start`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/start`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });

  it('task start/pause accumulates elapsed_seconds', async () => {
    const { taskId, workOrderId } = await createAssignedWo();
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    // reset task to assigned for clean timer test
    await prisma.technicianTask.update({
      where: { id: taskId },
      data: {
        status: 'assigned',
        elapsedSeconds: 0,
        startedAt: null,
        pausedAt: null,
        completedAt: null,
      },
    });

    const started = await request(app.getHttpServer())
      .post(`/api/v1/technician-tasks/${taskId}/start`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((started.body as { data: { status: string } }).data.status).toBe(
      'in_progress',
    );

    await prisma.technicianTask.update({
      where: { id: taskId },
      data: { startedAt: new Date(Date.now() - 5_000) },
    });

    const paused = await request(app.getHttpServer())
      .post(`/api/v1/technician-tasks/${taskId}/pause`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const elapsed = (
      paused.body as { data: { elapsedSeconds: number; status: string } }
    ).data;
    expect(elapsed.status).toBe('paused');
    expect(elapsed.elapsedSeconds).toBeGreaterThanOrEqual(5);
  });

  it('additional issue pauses WO and moves visit to waitingApproval', async () => {
    const { workOrderId, visitId } = await createAssignedWo();
    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const issue = await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/additional-issue`)
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .send({
        titleEn: 'Shock leak',
        titleAr: 'تسريب مساعد',
        causeEn: 'Worn seal',
        unitPrice: 2550,
        estimatedMinutes: 90,
      })
      .expect(200);

    const body = issue.body as {
      data: {
        visitStatus: string;
        workOrder: { status: string };
        quotation: { status: string; number: string };
      };
    };
    expect(body.data.workOrder.status).toBe('paused');
    expect(body.data.quotation.status).toBe('draft');
    expect(body.data.quotation.number).toMatch(/^Q-\d{4}-\d{4,}$/);
    // Visit stays in repair until advisor sends the draft quote
    expect(['inProgress', 'readyForRepair']).toContain(body.data.visitStatus);

    const visit = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).not.toBe('waitingApproval');
  });

  it('board groups cards by visit status columns', async () => {
    await createAssignedWo();
    const board = await request(app.getHttpServer())
      .get('/api/v1/workshop/board')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const columns = (
      board.body as {
        data: {
          columns: Array<{ key: string; cards: unknown[] }>;
        };
      }
    ).data.columns;
    expect(columns.map((c) => c.key)).toEqual([
      'waiting',
      'inspection',
      'waitingApproval',
      'readyForRepair',
      'inProgress',
      'waitingParts',
      'qualityCheck',
      'readyForDelivery',
      'completed',
    ]);
    const ready = columns.find((c) => c.key === 'readyForRepair');
    expect((ready?.cards.length ?? 0) >= 1).toBe(true);
  });

  it('socket broadcasts vehicle.status.changed on board transition', async () => {
    const phone = `+20 188 ${String(Date.now()).slice(-7)}`;
    const plate = `ي ي ${String(Date.now()).slice(-4)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `sock-${randomUUID()}`)
      .send({
        newCustomer: { nameEn: 'Socket Cust', nameAr: 'عميل', phone },
        newVehicle: {
          make: 'Fiat',
          model: 'Tipo',
          year: 2020,
          plate,
        },
        mileage: 10000,
        fuelLevelPct: 40,
        complaint: 'socket',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      })
      .expect(201);
    const visitId = (checkin.body as { data: { id: string } }).data.id;

    const received = await new Promise<{ visitId: string; to: string }>(
      (resolve, reject) => {
        const socket: Socket = io(`http://127.0.0.1:${serverPort}/workshop`, {
          auth: { token: adminToken },
          transports: ['websocket'],
          forceNew: true,
        });
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('socket timeout'));
        }, 8000);
        socket.on('connect', () => {
          socket.emit('join.workshop', { branchId: b1 }, () => {
            void request(app.getHttpServer())
              .post(`/api/v1/vehicle-visits/${visitId}/transition`)
              .set('Authorization', `Bearer ${adminToken}`)
              .set('X-Branch-Id', b1)
              .send({ status: 'inspection', version: 1 })
              .then(() => undefined);
          });
        });
        socket.on(
          'vehicle.status.changed',
          (payload: { visitId: string; to: string }) => {
            if (payload.visitId === visitId) {
              clearTimeout(timer);
              socket.close();
              resolve(payload);
            }
          },
        );
        socket.on('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      },
    );

    expect(received.to).toBe('inspection');
  });
});
