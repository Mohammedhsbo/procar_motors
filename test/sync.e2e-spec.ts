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

describe('Phase 17 Offline Sync (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let receptionToken: string;
  let adminToken: string;
  let techToken: string;
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
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;
    receptionToken = (await login('nourhan@promotors.eg')).data.accessToken;
    adminToken = (await login('kareem@promotors.eg')).data.accessToken;
    techToken = (await login('m.ahmed@promotors.eg')).data.accessToken;

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

  function op(
    entityType: string,
    action: string,
    payload: Record<string, unknown>,
    operationId = randomUUID(),
  ) {
    return {
      operationId,
      entityType,
      action,
      clientTimestamp: new Date().toISOString(),
      payload,
    };
  }

  it('applies offline check-in and is idempotent on duplicate operationId', async () => {
    const clientId = `dev-${randomUUID()}`;
    const operationId = randomUUID();
    const phone = `+20 155 ${String(Date.now()).slice(-7)}`;
    const plate = `س ن ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const body = {
      clientId,
      operations: [
        op(
          'vehicle_visit',
          'create',
          {
            clientId: randomUUID(),
            newCustomer: {
              nameEn: 'Sync Cust',
              nameAr: 'عميل مزامنة',
              phone,
            },
            newVehicle: {
              make: 'Fiat',
              model: 'Tipo',
              year: 2020,
              plate,
            },
            mileage: 22000,
            fuelLevelPct: 45,
            complaint: 'Offline check-in',
            priority: 'normal',
            expectedDeliveryAt: new Date(
              Date.now() + 8 * 3600_000,
            ).toISOString(),
          },
          operationId,
        ),
      ],
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send(body)
      .expect(201);

    const r1 = (
      first.body as {
        data: { results: Array<{ status: string; serverEntityId: string }> };
      }
    ).data.results[0];
    expect(r1.status).toBe('applied');
    expect(r1.serverEntityId).toBeTruthy();

    const second = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send(body)
      .expect(201);
    const r2 = (
      second.body as { data: { results: Array<{ serverEntityId: string }> } }
    ).data.results[0];
    expect(r2.serverEntityId).toBe(r1.serverEntityId);

    await request(app.getHttpServer())
      .get(`/api/v1/sync/status/${operationId}`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .query({ clientId })
      .expect(200);
  });

  it('merges customer create by phone', async () => {
    const existing = await prisma.customer.findFirstOrThrow({
      where: { phone: '+20 100 214 8890', deletedAt: null },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [
          op('customer', 'create', {
            nameEn: 'Ahmed Duplicate',
            nameAr: 'أحمد',
            phone: '+20 100 214 8890',
          }),
        ],
      })
      .expect(201);
    const row = (
      res.body as {
        data: { results: Array<{ merged?: boolean; serverEntityId: string }> };
      }
    ).data.results[0];
    expect(row.merged).toBe(true);
    expect(row.serverEntityId).toBe(existing.id);
  });

  it('conflicts on concurrent visit update with stale version', async () => {
    const phone = `+20 156 ${String(Date.now()).slice(-7)}`;
    const plate = `ج د ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [
          op('vehicle_visit', 'create', {
            newCustomer: { nameEn: 'Lock Cust', nameAr: 'قفل', phone },
            newVehicle: { make: 'Kia', model: 'Rio', year: 2019, plate },
            mileage: 10000,
            fuelLevelPct: 30,
            complaint: 'Original',
            priority: 'normal',
            expectedDeliveryAt: new Date(
              Date.now() + 8 * 3600_000,
            ).toISOString(),
          }),
        ],
      })
      .expect(201);
    const visitId = (
      created.body as { data: { results: Array<{ serverEntityId: string }> } }
    ).data.results[0].serverEntityId;

    const firstUpdate = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [
          op('vehicle_visit', 'update', {
            visitId,
            version: 1,
            complaint: 'First update',
          }),
        ],
      })
      .expect(201);
    expect(
      (firstUpdate.body as { data: { results: Array<{ status: string }> } })
        .data.results[0].status,
    ).toBe('applied');

    const secondUpdate = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [
          op('vehicle_visit', 'update', {
            visitId,
            version: 1,
            complaint: 'Stale update',
          }),
        ],
      })
      .expect(201);
    expect(
      (secondUpdate.body as { data: { results: Array<{ status: string }> } })
        .data.results[0].status,
    ).toBe('conflict');
  });

  it('partial success: allowed check-in plus forbidden payment', async () => {
    const phone = `+20 157 ${String(Date.now()).slice(-7)}`;
    const plate = `ه و ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [
          op('vehicle_visit', 'create', {
            newCustomer: { nameEn: 'Partial', nameAr: 'جزئي', phone },
            newVehicle: { make: 'Opel', model: 'Astra', year: 2018, plate },
            mileage: 8000,
            fuelLevelPct: 50,
            complaint: 'Partial batch',
            priority: 'normal',
            expectedDeliveryAt: new Date(
              Date.now() + 8 * 3600_000,
            ).toISOString(),
          }),
          op('payment', 'create', { amount: 100, invoiceId: randomUUID() }),
        ],
      })
      .expect(201);
    const results = (
      res.body as {
        data: { results: Array<{ status: string; error?: { code: string } }> };
      }
    ).data.results;
    expect(results[0].status).toBe('applied');
    expect(results[1].status).toBe('failed');
    expect(results[1].error?.code).toBe('FORBIDDEN');
  });

  it('rejects technician without visits.create and customer portal tokens', async () => {
    const payload = {
      clientId: `dev-${randomUUID()}`,
      operations: [
        op('customer', 'create', {
          nameEn: 'Nope',
          nameAr: 'لا',
          phone: `+20 158 ${String(Date.now()).slice(-7)}`,
        }),
      ],
    };
    await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${techToken}`)
      .set('X-Branch-Id', b1)
      .send(payload)
      .expect(403);

    if (customerToken) {
      await request(app.getHttpServer())
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('X-Branch-Id', b1)
        .send(payload)
        .expect(403);
    }

    await request(app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        clientId: `dev-${randomUUID()}`,
        operations: [op('stock', 'consume', { partId: randomUUID(), qty: 1 })],
      })
      .expect(201)
      .expect((r) => {
        const row = (r.body as { data: { results: Array<{ status: string }> } })
          .data.results[0];
        expect(row.status).toBe('failed');
      });
  });
});
