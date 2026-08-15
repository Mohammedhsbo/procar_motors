import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EnvConfig } from '../config/env.validation';
import { PrismaService } from '../database/prisma.service';

export type ReadyCheck = {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: {
    database: { status: 'ok' | 'unavailable'; detail?: string };
    redis: { status: 'ok' | 'unavailable'; detail?: string };
  };
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  getHealth() {
    return { status: 'ok' as const };
  }

  async getReady(): Promise<ReadyCheck> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const allOk = database.status === 'ok' && redis.status === 'ok';
    return {
      status: allOk ? 'ok' : 'unavailable',
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<{
    status: 'ok' | 'unavailable';
    detail?: string;
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', detail: 'prisma-connected' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Database check failed: ${detail}`);
      return { status: 'unavailable', detail };
    }
  }

  private async checkRedis(): Promise<{
    status: 'ok' | 'unavailable';
    detail?: string;
  }> {
    const redisUrl = this.config.get('REDIS_URL', { infer: true });
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return { status: 'ok', detail: pong };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Redis check failed: ${detail}`);
      return { status: 'unavailable', detail };
    } finally {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }
}
