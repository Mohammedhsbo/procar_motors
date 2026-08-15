import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis lock error: ${err.message}`);
    });
  }

  /**
   * Acquire a short-lived distributed lock. Returns unlock fn or null if held.
   */
  async tryLock(
    key: string,
    ttlMs: number,
  ): Promise<(() => Promise<void>) | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;
    const ok = await this.redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    return async () => {
      const current = await this.redis.get(`lock:${key}`);
      if (current === token) await this.redis.del(`lock:${key}`);
    };
  }

  getClient() {
    return this.redis;
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
