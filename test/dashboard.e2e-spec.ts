import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';
import { RedisCacheService } from '../src/infrastructure/cache/redis-cache.service';
import { OutboxDispatcherService } from '../src/infrastructure/jobs/outbox-dispatcher.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 15 Dashboard + Reports (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cache: RedisCacheService;
  let dispatcher: OutboxDispatcherService;
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
    cache = app.get(RedisCacheService);
    dispatcher = app.get(OutboxDispatcherService);

    const admin = await login('kareem@promotors.eg');
    adminToken = admin.data.accessToken;
    b1 =
      admin.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      admin.data.user.branchIds[0];

    const advisor = await login('mostafa@promotors.eg');
    advisorToken = advisor.data.accessToken;
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

  it('returns 8 dashboard KPIs for branch', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const kpis = (res.body as { data: { kpis: Record<string, unknown> } }).data
      .kpis;
    expect(kpis.vehiclesToday).toBeDefined();
    expect(kpis.activeJobs).toBeDefined();
    expect(kpis.pendingApprovals).toBeDefined();
    expect(kpis.vehiclesReady).toBeDefined();
    expect(kpis.revenueToday).toBeDefined();
    expect(kpis.outstandingPayments).toBeDefined();
    expect(kpis.lowStockItems).toBeDefined();
    expect(kpis.activeTechnicians).toBeDefined();
  });

  it('chart endpoints respond', async () => {
    for (const path of [
      '/api/v1/dashboard/revenue-overview',
      '/api/v1/dashboard/workshop-status',
      '/api/v1/dashboard/monthly-revenue',
      '/api/v1/dashboard/tech-productivity',
      '/api/v1/dashboard/recent-activities',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Branch-Id', b1)
        .expect(200);
    }
  });

  it('branch scoping: advisor without branch access is forbidden', async () => {
    const other = await prisma.branch.findFirst({
      where: { NOT: { id: b1 } },
    });
    if (!other) return;
    // advisor is b1-only typically
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', other.id)
      .expect(403);
  });

  it('invalidates dashboard cache on payment.received outbox', async () => {
    const org = await prisma.organization.findFirstOrThrow();
    const key = cache.dashKey(org.id, b1, 'summary');
    await cache.setJson(key, { cached: true }, 60);
    expect(await cache.getJson(key)).toEqual({ cached: true });

    await prisma.outboxEvent.create({
      data: {
        eventType: 'payment.received',
        payload: {
          organizationId: org.id,
          branchId: b1,
          amount: 1,
        },
        status: 'pending',
      },
    });
    await dispatcher.drain(20);
    expect(await cache.getJson(key)).toBeNull();
  });

  it('report endpoints work for super_admin', async () => {
    for (const path of [
      '/api/v1/reports/workshop',
      '/api/v1/reports/financial',
      '/api/v1/reports/inventory',
      '/api/v1/reports/technician-performance',
      '/api/v1/reports/analytics',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Branch-Id', b1)
        .expect(200);
    }
  });

  it('export job completes', async () => {
    const queued = await request(app.getHttpServer())
      .post('/api/v1/reports/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ kind: 'workshop', format: 'csv' })
      .expect(201);

    const jobId = (queued.body as { data: { jobId: string } }).data.jobId;
    expect(jobId).toBeTruthy();

    let status = 'queued';
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const poll = await request(app.getHttpServer())
        .get(`/api/v1/reports/export/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Branch-Id', b1)
        .expect(200);
      status = (poll.body as { data: { status: string } }).data.status;
      if (status === 'completed' || status === 'failed') break;
    }
    expect(status).toBe('completed');
  });

  it('super_admin can request branchId=all', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary?branchId=all')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
  });
});
