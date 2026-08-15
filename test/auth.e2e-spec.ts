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
    refreshToken: string;
    user: { email: string | null; roles: string[]; branchIds: string[] };
  };
};

describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let b1: string;
  let b2: string;
  let b3: string;

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
    b2 = branches.find((b) => b.code === 'b2')!.id;
    b3 = branches.find((b) => b.code === 'b3')!.id;
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

  it('login with valid credentials returns tokens', async () => {
    const body = await login('kareem@promotors.eg');
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
    expect(body.data.user.roles).toContain('super_admin');
  });

  it('login with wrong password returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'kareem@promotors.eg', password: 'WrongPassword1' })
      .expect(401);
    expect((res.body as { success: boolean }).success).toBe(false);
  });

  it('account locks after 5 failed logins', async () => {
    const email = `lockout-${Date.now()}@promotors.eg`;
    const admin = await prisma.user.findFirst({
      where: { email: 'kareem@promotors.eg' },
    });
    const employee = await prisma.employee.create({
      data: {
        organizationId: admin!.organizationId,
        branchId: b1,
        nameEn: 'Lock Test',
        nameAr: 'اختبار',
        status: 'active',
      },
    });
    const hashed = admin!.passwordHash;
    await prisma.user.create({
      data: {
        organizationId: admin!.organizationId,
        employeeId: employee.id,
        email,
        passwordHash: hashed,
        userType: 'staff',
        status: 'active',
      },
    });

    for (let i = 0; i < 4; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword1' })
        .expect(401);
    }
    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1' })
      .expect(423);
    expect((locked.body as { error: { code: string } }).error.code).toBe(
      'ACCOUNT_LOCKED',
    );
  });

  it('refresh rotates tokens', async () => {
    const body = await login('kareem@promotors.eg');
    const firstRefresh = body.data.refreshToken;
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(201);
    const rotatedBody = rotated.body as LoginBody;
    expect(rotatedBody.data.accessToken).toBeDefined();
    expect(rotatedBody.data.refreshToken).not.toBe(firstRefresh);

    // Old refresh should fail (revoked / reuse path)
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
  });

  it('GET /auth/me returns profile', async () => {
    const body = await login('kareem@promotors.eg');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);
    expect((me.body as { data: { email: string } }).data.email).toBe(
      'kareem@promotors.eg',
    );
  });

  it('admin can access users.view on any branch', async () => {
    const body = await login('kareem@promotors.eg');
    const res = await request(app.getHttpServer())
      .get('/api/v1/rbac-check/users-view')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .set('X-Branch-Id', b3)
      .expect(200);
    expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  it('technician cannot access users.view', async () => {
    const body = await login('m.ahmed@promotors.eg');
    await request(app.getHttpServer())
      .get('/api/v1/rbac-check/users-view')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .set('X-Branch-Id', b1)
      .expect(403);
  });

  it('technician cannot use unauthorized branch', async () => {
    const body = await login('m.ahmed@promotors.eg');
    await request(app.getHttpServer())
      .get('/api/v1/rbac-check/branch-only')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .set('X-Branch-Id', b2)
      .expect(403);
  });

  it('technician can access home branch without special permission', async () => {
    const body = await login('m.ahmed@promotors.eg');
    const res = await request(app.getHttpServer())
      .get('/api/v1/rbac-check/branch-only')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .set('X-Branch-Id', b1)
      .expect(200);
    expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);
  });
});
