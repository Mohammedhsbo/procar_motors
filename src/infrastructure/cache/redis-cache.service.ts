import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

/** Domain events that should clear dashboard KPI caches. */
export const DASHBOARD_INVALIDATING_EVENTS = new Set([
  'vehicle.visit.created',
  'vehicle.status.changed',
  'vehicle.ready',
  'vehicle.delivered',
  'quotation.sent',
  'quotation.approved',
  'quotation.rejected',
  'quotation.expired',
  'payment.received',
  'invoice.issued',
  'invoice.cancelled',
  'inventory.low_stock',
  'qc.failed',
  'qc.passed',
]);

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly redis: Redis;
  readonly defaultTtlSec = 45;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis cache error: ${err.message}`);
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec = this.defaultTtlSec) {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  }

  async getOrSetJson<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSec = this.defaultTtlSec,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;
    const fresh = await factory();
    await this.setJson(key, fresh, ttlSec);
    return fresh;
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  /** Delete keys matching pattern (SCAN + DEL). */
  async delByPattern(pattern: string) {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  dashKey(organizationId: string, branchKey: string, name: string) {
    return `dash:${organizationId}:${branchKey}:${name}`;
  }

  async invalidateDashboard(
    organizationId?: string | null,
    branchId?: string | null,
  ) {
    if (organizationId && branchId) {
      await this.delByPattern(`dash:${organizationId}:${branchId}:*`);
      await this.delByPattern(`dash:${organizationId}:all:*`);
      return;
    }
    if (organizationId) {
      await this.delByPattern(`dash:${organizationId}:*`);
      return;
    }
    await this.delByPattern('dash:*');
  }

  reportKey(jobId: string) {
    return `report:export:${jobId}`;
  }

  getClient() {
    return this.redis;
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
