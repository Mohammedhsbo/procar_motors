import type { EnvConfig } from './env.validation';

export default (): EnvConfig => ({
  NODE_ENV: (process.env.NODE_ENV as EnvConfig['NODE_ENV']) ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://promotors:promotors@localhost:5432/pro_motors_db?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  CORS_ORIGINS:
    process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3001',
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me-32',
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me-32',
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '15m',
  JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL ?? '7d',
  RATE_LIMIT_TTL_MS: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
  RATE_LIMIT_LIMIT: Number(process.env.RATE_LIMIT_LIMIT ?? 120),
  STORAGE_DRIVER:
    (process.env.STORAGE_DRIVER as EnvConfig['STORAGE_DRIVER']) ?? 'local',
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? './storage/uploads',
  R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY ?? '',
  R2_SECRET_KEY: process.env.R2_SECRET_KEY ?? '',
  R2_BUCKET: process.env.R2_BUCKET ?? '',
  JOB_SCHEDULER_ENABLED:
    process.env.JOB_SCHEDULER_ENABLED === 'false' ? 'false' : 'true',
});
