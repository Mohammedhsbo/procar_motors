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

describe('Phase 6 Inspections (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let adminToken: string;
  let advisorToken: string;
  let receptionToken: string;

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
    receptionToken = (await login('nourhan@promotors.eg')).data.accessToken;
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

  async function checkInVisit() {
    const phone = `+20 181 ${String(Date.now()).slice(-7)}`;
    const plate = `ف ح ص ${String(Date.now()).slice(-4)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/vehicle-visits/check-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .set('Idempotency-Key', `insp-${randomUUID()}`)
      .send({
        newCustomer: {
          nameEn: 'Inspectee',
          nameAr: 'عميل فحص',
          phone,
        },
        newVehicle: {
          make: 'Toyota',
          model: 'Corolla',
          year: 2023,
          plate,
        },
        mileage: 62000,
        fuelLevelPct: 50,
        complaint: 'Brakes and oil',
        priority: 'normal',
        expectedDeliveryAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      })
      .expect(201);
    return (res.body as { data: { id: string; status: string } }).data;
  }

  it('lists default 10-point template', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/inspection-templates')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const templates = (
      res.body as {
        data: Array<{ code: string; items: unknown[]; nameEn: string }>;
      }
    ).data;
    const def = templates.find((t) => t.code === 'DEFAULT_10PT');
    expect(def).toBeTruthy();
    expect(def!.items).toHaveLength(10);
    expect(def!.nameEn).toContain('10-Point');
  });

  it('full inspection flow creates draft quotation and waitingApproval', async () => {
    const visit = await checkInVisit();
    expect(visit.status).toBe('waiting');

    const created = await request(app.getHttpServer())
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ visitId: visit.id })
      .expect(201);

    const inspection = (
      created.body as {
        data: {
          id: string;
          status: string;
          visitStatus: string;
          templateVersion: number;
          checklist: Array<{ templateItemId: string }>;
        };
      }
    ).data;
    expect(inspection.status).toBe('in_progress');
    expect(inspection.visitStatus).toBe('inspection');
    expect(inspection.templateVersion).toBe(1);
    expect(inspection.checklist).toHaveLength(10);

    const results = inspection.checklist.map((c, idx) => ({
      templateItemId: c.templateItemId,
      state: idx === 2 ? 'failed' : idx === 0 ? 'warning' : 'ok',
      note: idx === 2 ? 'Front pads worn' : undefined,
    }));

    await request(app.getHttpServer())
      .patch(`/api/v1/inspections/${inspection.id}/results`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ results })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/inspections/${inspection.id}/findings`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        titleEn: 'Front brake pads worn',
        titleAr: 'تآكل تيل الفرامل الأمامي',
        causeEn: 'Normal wear',
        causeAr: 'تآكل طبيعي',
        severity: 'high',
        recommendedActionEn: 'Replace pads and machine discs',
        recommendedActionAr: 'تغيير التيل وخراطة الهوبات',
        estimatedMinutes: 90,
      })
      .expect(201);

    const completed = await request(app.getHttpServer())
      .post(`/api/v1/inspections/${inspection.id}/complete`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({
        recommendedItems: [
          {
            kind: 'part',
            nameEn: 'Front Brake Pads – Toyota',
            nameAr: 'تيل فرامل أمامي – تويوتا',
            qty: 1,
            unitPrice: 950,
          },
          {
            kind: 'service',
            nameEn: 'Brake system service',
            nameAr: 'خدمة نظام الفرامل',
            qty: 1,
            unitPrice: 900,
          },
        ],
      })
      .expect(201);

    const body = completed.body as {
      data: {
        visitStatus: string;
        inspection: { status: string; templateVersion: number };
        quotation: {
          number: string;
          status: string;
          total: number;
          items: unknown[];
        };
      };
    };
    expect(body.data.visitStatus).toBe('waitingApproval');
    expect(body.data.inspection.status).toBe('completed');
    expect(body.data.quotation.status).toBe('draft');
    expect(body.data.quotation.number).toMatch(/^Q-\d{4}-\d{4,}$/);
    expect(body.data.quotation.items.length).toBeGreaterThanOrEqual(3);
    expect(body.data.quotation.total).toBeGreaterThan(0);

    const visitRow = await prisma.vehicleVisit.findUniqueOrThrow({
      where: { id: visit.id },
    });
    expect(visitRow.status).toBe('waitingApproval');

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: 'inspection.completed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).toBeTruthy();
  });

  it('reception can view templates but cannot create inspection', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/inspection-templates')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const visit = await checkInVisit();
    await request(app.getHttpServer())
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({ visitId: visit.id })
      .expect(403);
  });

  it('rejects complete when checklist incomplete', async () => {
    const visit = await checkInVisit();
    const created = await request(app.getHttpServer())
      .post('/api/v1/inspections')
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({ visitId: visit.id })
      .expect(201);
    const id = (created.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/inspections/${id}/complete`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Branch-Id', b1)
      .send({})
      .expect(400);
  });
});
