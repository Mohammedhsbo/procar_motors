import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      'postgresql://promotors:promotors@localhost:5432/pro_motors_db?schema=public',
    ),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3001'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(16)
    .default('dev-access-secret-change-me-32'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16)
    .default('dev-refresh-secret-change-me-32'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(120),
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/uploads'),
  R2_ENDPOINT: z.string().optional().default(''),
  R2_ACCESS_KEY: z.string().optional().default(''),
  R2_SECRET_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  JOB_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  assertProductionSecrets(parsed.data, config);
  return parsed.data;
}

const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'CORS_ORIGINS',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

export function assertProductionSecrets(
  env: EnvConfig,
  raw?: Record<string, unknown>,
) {
  if (env.NODE_ENV !== 'production') return;
  const source = raw ?? process.env;
  for (const key of PRODUCTION_REQUIRED) {
    const value = source[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Production requires ${key} to be set explicitly`);
    }
  }
  const weak = [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET].some(
    (s) =>
      s.length < 32 ||
      s.includes('change-me') ||
      s.includes('dev-access') ||
      s.includes('dev-refresh'),
  );
  if (weak) {
    throw new Error(
      'Production JWT secrets must be unique, at least 32 characters, and must not use development defaults',
    );
  }
}
