import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

type ApiSuccessBody = {
  success: boolean;
  data: {
    status: string;
    checks?: {
      database: { status: string };
      redis: { status: string };
    };
  };
  meta: { requestId: string };
};

type ApiErrorBody = {
  success: boolean;
  error: { code: string; message: string };
  requestId: string;
};

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health', 'ready'],
    });
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as ApiSuccessBody;

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ status: 'ok' });
    expect(body.meta.requestId).toBeDefined();
  });

  it('GET /unknown returns standard error envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    const body = res.body as ApiErrorBody;

    expect(body.success).toBe(false);
    expect(body.error.code).toBeDefined();
    expect(body.error.message).toBeDefined();
    expect(body.requestId).toBeDefined();
  });

  it('GET /ready returns 200 when dependencies are up, else 503', async () => {
    const res = await request(app.getHttpServer()).get('/ready');

    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body as ApiSuccessBody;
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ok');
      expect(body.data.checks?.database.status).toBe('ok');
      expect(body.data.checks?.redis.status).toBe('ok');
    } else {
      const body = res.body as ApiErrorBody;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});
