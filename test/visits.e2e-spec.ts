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

describe('Phase 5 Visits + Files (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let receptionToken: string;
  let technicianToken: string;

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
    receptionToken = (await login('nourhan@promotors.eg')).data.accessToken;
    technicianToken = (await login('m.ahmed@promotors.eg')).data.accessToken;
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

  it('check-in with existing customer+vehicle creates visit + JT', async () => {
    const phone = `+20 174 ${String(Date.now()).slice(-7)}`;
    const plate = `م و ج ${String(Date.now()).slice(-4)}`;
    const customerRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        nameEn: 'Visit Owner',
        nameAr: 'مالك الزيارة',
        phone,
      })
      .expect(201);
    const customerId = (customerRes.body as { data: { id: string } }).data.id;

    const vehicleRes = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        customerId,
        plate,
        make: 'Mazda',
        model: '3',
        year: 2021,
        fuelType: 'petrol',
        transmission: 'auto',
        mileageCurrent: 30000,
      })
      .expect(201);
    const vehicleId = (vehicleRes.body as { data: { id: string } }).data.id;

    const res = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `e2e-existing-${randomUUID()}`)
      .send({
        customerId,
        vehicleId,
        mileage: 30100,
        fuelLevelPct: 40,
        exteriorCondition: 'good',
        complaint: 'Strange noise from engine bay',
        priority: 'high',
        expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
        damagePoints: [
          {
            xPct: 20,
            yPct: 35,
            labelEn: 'Hood scratch',
            labelAr: 'خدش غطاء المحرك',
          },
        ],
      })
      .expect(201);

    const body = res.body as {
      data: {
        id: string;
        status: string;
        ticket: string;
        version: number;
        damagePoints: unknown[];
      };
    };
    expect(body.data.status).toBe('waiting');
    expect(body.data.ticket).toMatch(/^JT-\d{4}-\d{4,}$/);
    expect(body.data.damagePoints).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entity: 'VehicleVisit',
        entityId: body.data.id,
        action: 'visit.check_in',
      },
    });
    expect(audit).toBeTruthy();

    const outbox = await prisma.outboxEvent.findFirst({
      where: { eventType: 'vehicle.visit.created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(outbox).toBeTruthy();
  });

  it('check-in with inline new customer + vehicle', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const phone = `+20 170 ${suffix.slice(0, 7)}`;
    const plate = `ف ق ر ${suffix.slice(0, 6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `e2e-new-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'Phase Five Guest',
          nameAr: 'ضيف المرحلة الخامسة',
          phone,
        },
        newVehicle: {
          make: 'Kia',
          model: 'Sportage',
          year: 2024,
          plate,
          fuelType: 'petrol',
          transmission: 'auto',
        },
        mileage: 1200,
        fuelLevelPct: 70,
        complaint: 'Oil change and cabin filter',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      })
      .expect(201);

    const data = (res.body as { data: { ticket: string; phone: string } }).data;
    expect(data.ticket).toMatch(/^JT-\d{4}-\d{4,}$/);
    expect(data.phone).toBe(phone);
  });

  it('idempotent check-in returns same visit', async () => {
    const key = `e2e-idem-${randomUUID()}`;
    const phone = `+20 171 ${String(Date.now()).slice(-7)}`;
    const payload = {
      newCustomer: {
        nameEn: 'Idem User',
        nameAr: 'مستخدم',
        phone,
      },
      newVehicle: {
        make: 'Toyota',
        model: 'Yaris',
        year: 2022,
        plate: `ي ر س ${String(Date.now()).slice(-4)}`,
      },
      mileage: 9000,
      fuelLevelPct: 50,
      complaint: 'AC not cooling',
      priority: 'normal',
      expectedDeliveryAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    expect((second.body as { data: { id: string } }).data.id).toBe(
      (first.body as { data: { id: string } }).data.id,
    );
  });

  it('rejects invalid transition and enforces optimistic lock', async () => {
    const phone = `+20 172 ${String(Date.now()).slice(-7)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `e2e-trans-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'Trans User',
          nameAr: 'انتقال',
          phone,
        },
        newVehicle: {
          make: 'Ford',
          model: 'Focus',
          year: 2017,
          plate: `ف و ر ${String(Date.now()).slice(-4)}`,
        },
        mileage: 150000,
        fuelLevelPct: 10,
        complaint: 'Brake pads',
        priority: 'urgent',
        expectedDeliveryAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      })
      .expect(201);

    const visit = (created.body as { data: { id: string; version: number } })
      .data;

    const invalid = await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visit.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'completed', version: visit.version })
      .expect(409);
    expect((invalid.body as { error: { code: string } }).error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visit.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'inspection', version: visit.version })
      .expect(200);

    const stale = await request(app.getHttpServer())
      .post(`/api/v1/vehicle-visits/${visit.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'waitingApproval', version: visit.version })
      .expect(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe(
      'OPTIMISTIC_LOCK',
    );
  });

  it('technician cannot check-in; reception can list tickets', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${technicianToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `e2e-tech-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'No',
          nameAr: 'لا',
          phone: `+20 173 ${String(Date.now()).slice(-7)}`,
        },
        newVehicle: {
          make: 'X',
          model: 'Y',
          year: 2020,
          plate: `ت ك ن ${String(Date.now()).slice(-4)}`,
        },
        mileage: 1,
        fuelLevelPct: 1,
        complaint: 'x',
        priority: 'low',
        expectedDeliveryAt: new Date().toISOString(),
      })
      .expect(403);

    const tickets = await request(app.getHttpServer())
      .get('/api/v1/job-tickets')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect(
      (tickets.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('file upload → confirm → attach flow works', async () => {
    const intent = await request(app.getHttpServer())
      .post('/api/v1/files/uploads')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        filename: 'damage.jpg',
        mimeType: 'image/jpeg',
        size: 12,
      })
      .expect(201);

    const fileId = (intent.body as { data: { fileId: string } }).data.fileId;
    const bytes = Buffer.from('fake-image!!');

    await request(app.getHttpServer())
      .put(`/api/v1/files/${fileId}/content`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ base64: bytes.toString('base64') })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/files/${fileId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(201);

    const visit = await prisma.vehicleVisit.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });

    const att = await request(app.getHttpServer())
      .post('/api/v1/attachments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        fileId,
        entityType: 'VehicleVisit',
        entityId: visit.id,
        kind: 'photo',
        phase: 'before',
      })
      .expect(201);

    expect((att.body as { data: { fileId: string } }).data.fileId).toBe(fileId);

    await request(app.getHttpServer())
      .post('/api/v1/files/uploads')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        filename: 'bad.exe',
        mimeType: 'application/x-msdownload',
        size: 10,
      })
      .expect(400);
  });
});
