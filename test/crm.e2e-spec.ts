import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';

type LoginBody = {
  success: boolean;
  data: {
    accessToken: string;
    user: { branchIds: string[] };
  };
};

describe('Phase 4 Customers + Vehicles + Search (e2e)', () => {
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

  it('lists customers with bilingual fields and counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const body = res.body as {
      data: Array<{
        nameEn: string;
        nameAr: string;
        phone: string;
        status: string;
        vehiclesCount: number;
      }>;
    };
    expect(body.data.length).toBeGreaterThanOrEqual(7);
    const ahmed = body.data.find((c) => c.phone === '+20 100 214 8890');
    expect(ahmed?.nameEn).toBe('Ahmed Hassan');
    expect(ahmed?.nameAr).toBe('أحمد حسن');
    expect(ahmed?.vehiclesCount).toBeGreaterThanOrEqual(1);
  });

  it('enforces phone uniqueness per org', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        nameEn: 'Dup Phone',
        nameAr: 'هاتف مكرر',
        phone: '+20 100 214 8890',
      })
      .expect(409);
  });

  it('reception can create customer; technician cannot', async () => {
    const phone = `+20 155 ${String(Date.now()).slice(-7)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({
        nameEn: 'Reception Customer',
        nameAr: 'عميل الاستقبال',
        phone,
        status: 'active',
      })
      .expect(201);
    expect((created.body as { data: { nameEn: string } }).data.nameEn).toBe(
      'Reception Customer',
    );

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${technicianToken}`)
      .set('X-Branch-Id', b1)
      .send({
        nameEn: 'Tech Customer',
        nameAr: 'عميل الفني',
        phone: `+20 166 ${String(Date.now()).slice(-7)}`,
      })
      .expect(403);
  });

  it('creates vehicle linked to customer and enforces plate uniqueness', async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { phone: '+20 100 214 8890' },
    });
    const plate = `ت ج ر ${String(Date.now()).slice(-4)}`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        customerId: customer.id,
        plate,
        make: 'Nissan',
        model: 'Sunny',
        year: 2018,
        fuelType: 'petrol',
        transmission: 'auto',
        mileageCurrent: 120000,
      })
      .expect(201);

    const vehicleId = (created.body as { data: { id: string; plate: string } })
      .data.id;
    expect((created.body as { data: { plate: string } }).data.plate).toBe(
      plate,
    );

    await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        customerId: customer.id,
        plate,
        make: 'Nissan',
        model: 'Sunny',
        year: 2018,
      })
      .expect(409);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);

    const detailBody = detail.body as {
      data: {
        overview: { make: string; plate: string };
        stats: {
          totalVisits: number;
          totalSpent: number;
          mileage: number | null;
          openIssues: number;
        };
        serviceHistory: unknown[];
        documents: unknown[];
        media: unknown[];
        warranties: unknown[];
        maintenance: unknown[];
        activity: unknown[];
      };
    };
    expect(detailBody.data.overview.make).toBe('Nissan');
    expect(detailBody.data.stats.totalVisits).toBe(0);
    expect(detailBody.data.serviceHistory).toEqual([]);
    expect(Array.isArray(detailBody.data.activity)).toBe(true);

    const owned = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customer.id}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect(
      (owned.body as { data: Array<{ id: string }> }).data.some(
        (v) => v.id === vehicleId,
      ),
    ).toBe(true);
  });

  it('search finds customers by name and vehicles by plate', async () => {
    const byName = await request(app.getHttpServer())
      .get('/api/v1/search')
      .query({ q: 'Ahmed' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const nameBody = byName.body as {
      data: {
        customers: Array<{ nameEn: string }>;
        vehicles: unknown[];
        parts: unknown[];
      };
    };
    expect(
      nameBody.data.customers.some((c) => c.nameEn.includes('Ahmed')),
    ).toBe(true);

    const byPlate = await request(app.getHttpServer())
      .get('/api/v1/search')
      .query({ q: '4521' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const plateBody = byPlate.body as {
      data: { vehicles: Array<{ plate: string }> };
    };
    expect(plateBody.data.vehicles.some((v) => v.plate.includes('4521'))).toBe(
      true,
    );
  });
});
