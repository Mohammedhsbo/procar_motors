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
  data: { accessToken: string; user: { branchIds: string[]; id: string } };
};

describe('Phase 16 Customer Portal (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let customerPhone: string;
  let otherCustomerId: string;

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

    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'kareem@promotors.eg', password: 'Password123!' })
      .expect(201);
    const body = admin.body as LoginBody;
    adminToken = body.data.accessToken;
    b1 =
      body.data.user.branchIds.find((id) => id.endsWith('00b1')) ||
      body.data.user.branchIds[0];

    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      take: 2,
      orderBy: { createdAt: 'asc' },
    });
    customerPhone = customers[0].phone;
    otherCustomerId = customers[1].id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function portalLogin(phone: string) {
    const otp = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/request-otp')
      .send({ phone })
      .expect(200);
    const code = (otp.body as { data: { devCode: string } }).data.devCode;
    expect(code).toBeTruthy();
    const verify = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/verify-otp')
      .send({ phone, code })
      .expect(200);
    return verify.body as {
      data: {
        accessToken: string;
        user: { customerId: string; userType: string };
      };
    };
  }

  it('OTP login issues customer JWT', async () => {
    const session = await portalLogin(customerPhone);
    expect(session.data.user.userType).toBe('customer');
    expect(session.data.user.customerId).toBeTruthy();
    expect(session.data.accessToken).toBeTruthy();
  });

  it('customer cannot access staff dashboard', async () => {
    const session = await portalLogin(customerPhone);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .set('X-Branch-Id', b1)
      .expect(403);
  });

  it('staff cannot use portal customer endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/portal/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('customer cannot read another customer visit (IDOR)', async () => {
    const session = await portalLogin(customerPhone);
    const foreignVisit = await prisma.vehicleVisit.findFirst({
      where: { customerId: otherCustomerId, deletedAt: null },
    });
    if (!foreignVisit) return;
    await request(app.getHttpServer())
      .get(`/api/v1/portal/visits/${foreignVisit.id}/status`)
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .expect(404);
  });

  it('approve quotation as customer moves visit to readyForRepair', async () => {
    const phone = `+20 198 ${String(Date.now()).slice(-7)}`;
    const plate = `ب و ${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `p16-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'Portal Cust',
          nameAr: 'عميل بوابة',
          phone,
        },
        newVehicle: { make: 'Toyota', model: 'Yaris', year: 2021, plate },
        mileage: 12000,
        fuelLevelPct: 40,
        complaint: 'Portal approve',
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

    const advisor = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'mostafa@promotors.eg', password: 'Password123!' })
      .expect(201);
    const advisorToken = (advisor.body as LoginBody).data.accessToken;

    const created = await request(app.getHttpServer())
      .post('/api/v1/quotations')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        visitId,
        items: [
          {
            kind: 'labor',
            nameEn: 'Portal Labor',
            nameAr: 'عمالة',
            qty: 1,
            unitPrice: 250,
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

    const session = await portalLogin(phone);
    const statusBefore = await request(app.getHttpServer())
      .get(`/api/v1/portal/visits/${visitId}/status`)
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .expect(200);
    expect(
      (statusBefore.body as { data: { portalStage: string } }).data.portalStage,
    ).toBe('quotation');

    await request(app.getHttpServer())
      .post(`/api/v1/portal/quotations/${quoteId}/approve`)
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .send({ comment: 'OK from portal' })
      .expect(201);

    const visit = await prisma.vehicleVisit.findFirstOrThrow({
      where: { id: visitId },
    });
    expect(visit.status).toBe('readyForRepair');

    const approval = await prisma.quotationApproval.findFirst({
      where: { quotationId: quoteId, actorType: 'customer' },
    });
    expect(approval).toBeTruthy();
  });

  it('feedback and lists work for owner', async () => {
    const session = await portalLogin(customerPhone);
    await request(app.getHttpServer())
      .get('/api/v1/portal/vehicles')
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/portal/invoices')
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/portal/service-history')
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/portal/feedback')
      .set('Authorization', `Bearer ${session.data.accessToken}`)
      .send({ rating: 5, comment: 'Great service' })
      .expect(201);
  });
});
