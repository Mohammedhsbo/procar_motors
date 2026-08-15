import { validateEnv } from './env.validation';

describe('production secrets', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://promotors:promotors@localhost:5432/pro_motors_db',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: 'https://app.example.com',
    JWT_ACCESS_SECRET: 'prod-access-secret-must-be-32chars!',
    JWT_REFRESH_SECRET: 'prod-refresh-secret-must-be-32ch!!',
  };

  it('rejects development JWT defaults in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        JWT_ACCESS_SECRET: 'dev-access-secret-change-me-32',
        JWT_REFRESH_SECRET: 'prod-refresh-secret-must-be-32ch!!',
      }),
    ).toThrow(/Production JWT secrets/);
  });

  it('accepts strong production secrets', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('production');
  });

  it('rejects missing DATABASE_URL in production', () => {
    const rest: Record<string, string> = { ...base };
    delete rest.DATABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
