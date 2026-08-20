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
import { DomainEventBus } from '../src/common/services/domain-event-bus.service';

type LoginBody = {
  data: { accessToken: string; user: { branchIds: string[] } };
};

describe('Phase 18 Ecosystem stubs (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcherService;
  let bus: DomainEventBus;
  let b1: string;
  let staffToken: string;
  let customerToken: string | null = null;

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
    bus = app.get(DomainEventBus);
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    staffToken = (await login('nourhan@promotors.eg')).data.accessToken;

    const otp = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/request-otp')
      .send({ phone: '+20 100 214 8890' });
    const code = (otp.body as { data?: { devCode?: string } }).data?.devCode;
    if (code) {
      const verify = await request(app.getHttpServer())
        .post('/api/v1/portal/auth/verify-otp')
        .send({ phone: '+20 100 214 8890', code });
      customerToken =
        (verify.body as { data?: { accessToken?: string } }).data
          ?.accessToken ?? null;
    }
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

  it.each([
    '/api/v1/uxp/health',
    '/api/v1/tireszone/health',
    '/api/v1/daily-cafe/health',
  ])('staff can read %s', async (path) => {
    const res = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const data = (res.body as { data: { status: string; ready?: boolean } })
      .data;
    // uxp is still an integration stub; tirezone and daily-cafe are now real
    // modules backed by their own schemas (phases 05 and 07).
    expect(['stub', 'ready']).toContain(data.status);
  });

  it('rejects unauthenticated and customer portal tokens', async () => {
    await request(app.getHttpServer()).get('/api/v1/uxp/health').expect(401);

    if (customerToken) {
      await request(app.getHttpServer())
        .get('/api/v1/uxp/health')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('X-Branch-Id', b1)
        .expect(403);
    }
  });

  it('outbox drain publishes to the internal domain event bus', async () => {
    const seen: string[] = [];
    const off = bus.onAll((e) => seen.push(e.eventType));
    await prisma.outboxEvent.create({
      data: {
        eventType: 'vehicle.visit.created',
        payload: {
          visitId: randomUUID(),
          organizationId: randomUUID(),
          branchId: b1,
        },
        status: 'pending',
      },
    });
    const result = await dispatcher.drain(20);
    off();
    expect(result.claimed).toBeGreaterThan(0);
    expect(seen).toContain('vehicle.visit.created');
  });

  it('ecosystem tables are readable and seeded', async () => {
    const profile = await prisma.uxpProfile.findFirst();
    const product = await prisma.tireProduct.findFirst();
    const service = await prisma.uxbService.findFirst();
    const variant = await prisma.cafeProductVariant.findFirst();
    expect(profile).toBeTruthy();
    expect(product).toBeTruthy();
    expect(service).toBeTruthy();
    expect(variant).toBeTruthy();
  });
});
