import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/database/prisma.service';
import { NumberSequenceService } from '../src/common/services/number-sequence.service';

type LoginBody = {
  success: boolean;
  data: {
    accessToken: string;
    user: {
      id?: string;
      email: string | null;
      roles: string[];
      branchIds: string[];
    };
  };
};

describe('Phase 3 Core (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sequences: NumberSequenceService;
  let b1: string;
  let orgId: string;
  let adminToken: string;
  let adminUserId: string;
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
    sequences = app.get(NumberSequenceService);
    const org = await prisma.organization.findFirstOrThrow();
    orgId = org.id;
    const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
    b1 = branches.find((b) => b.code === 'b1')!.id;

    const admin = await login('kareem@promotors.eg');
    adminToken = admin.data.accessToken;
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    adminUserId = (me.body as { data: { id: string } }).data.id;

    const reception = await login('nourhan@promotors.eg');
    receptionToken = reception.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password = 'Password123!') {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body as LoginBody;
  }

  it('GET /branches returns seeded branches with EN/AR names', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const body = res.body as {
      success: boolean;
      data: Array<{ code: string; nameEn: string; nameAr: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.data.find((b) => b.code === 'b1')?.nameEn).toBe('Nasr City');
    expect(body.data.find((b) => b.code === 'b1')?.nameAr).toBe('مدينة نصر');
  });

  it('GET /users returns demo users with role + branch + status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const body = res.body as {
      data: Array<{
        email: string | null;
        status: string;
        role: { key: string } | null;
        branch: { code: string } | null;
      }>;
    };
    expect(body.data.length).toBeGreaterThanOrEqual(8);
    const kareem = body.data.find((u) => u.email === 'kareem@promotors.eg');
    expect(kareem?.role?.key).toBe('super_admin');
    expect(kareem?.branch?.code).toBe('b1');
    expect(kareem?.status).toBe('active');
  });

  it('user CRUD + cannot suspend self', async () => {
    const email = `phase3-${Date.now()}@promotors.eg`;
    const create = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        email,
        password: 'Password123!',
        nameEn: 'Phase Three',
        nameAr: 'المرحلة الثالثة',
        phone: '+20 100 000 0001',
        roleKey: 'reception',
        branchIds: [b1],
      })
      .expect(201);

    const created = create.body as {
      data: { id: string; email: string; role: { key: string } };
    };
    expect(created.data.email).toBe(email);
    expect(created.data.role.key).toBe('reception');

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${created.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'suspended' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${adminUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ status: 'suspended' })
      .expect(422);
  });

  it('GET/PATCH role permissions + audit', async () => {
    const roles = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const roleList = (
      roles.body as { data: Array<{ id: string; key: string }> }
    ).data;
    const reception = roleList.find((r) => r.key === 'reception')!;

    const matrix = await request(app.getHttpServer())
      .get(`/api/v1/roles/${reception.id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const matrixBody = matrix.body as {
      data: {
        permissionRows: unknown[];
        permissionCols: unknown[];
        cells: unknown[];
      };
    };
    expect(matrixBody.data.permissionRows).toHaveLength(13);
    expect(matrixBody.data.permissionCols).toHaveLength(6);

    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${reception.id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({
        permissionKeys: [
          'customers.view',
          'customers.create',
          'customers.update',
          'vehicles.view',
          'vehicles.create',
          'vehicles.update',
          'visits.view',
          'visits.create',
          'visits.update',
          'inspections.view',
          'reports.view',
        ],
      })
      .expect(200);

    const logs = await request(app.getHttpServer())
      .get('/api/v1/audit-logs?entity=Role')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const audit = logs.body as { data: Array<{ action: string }> };
    expect(audit.data.some((l) => l.action === 'role.permissions.update')).toBe(
      true,
    );
  });

  it('PATCH /settings updates tax rate + writes audit', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .send({ defaultTaxRate: 14 })
      .expect(200);
    const body = res.body as {
      data: { defaultTaxRate: number; currency: string };
    };
    expect(body.data.defaultTaxRate).toBe(14);
    expect(body.data.currency).toBe('EGP');

    const logs = await request(app.getHttpServer())
      .get('/api/v1/audit-logs?entity=SystemSetting')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    const audit = logs.body as { data: Array<{ action: string }> };
    expect(audit.data.some((l) => l.action === 'settings.update')).toBe(true);
  });

  it('non-admin cannot PATCH /roles', async () => {
    const roles = await prisma.role.findFirst({
      where: { key: 'technician', organizationId: orgId },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${roles!.id}/permissions`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('X-Branch-Id', b1)
      .send({ permissionKeys: ['customers.view'] })
      .expect(403);
  });

  it('NumberSequence generates JT-YYYY-#### and is unique under concurrency', async () => {
    const year = new Date().getFullYear();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sequences.next(orgId, 'JT')),
    );
    expect(new Set(results).size).toBe(10);
    for (const n of results) {
      expect(n).toMatch(new RegExp(`^JT-${year}-\\d{4}$`));
    }
  });
});
