import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { WorkshopRealtimeService } from '../realtime/workshop-realtime.service';
import {
  DASHBOARD_INVALIDATING_EVENTS,
  RedisCacheService,
} from '../cache/redis-cache.service';
import { DomainEventBus } from '../../common/services/domain-event-bus.service';

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: WorkshopRealtimeService,
    private readonly cache: RedisCacheService,
    private readonly bus: DomainEventBus,
  ) {}

  /**
   * Claim pending outbox rows with SKIP LOCKED and dispatch notifications
   * inside the same transaction so concurrent workers cannot double-claim.
   */
  async drain(limit = 50) {
    const published: Array<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }> = [];

    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<
          Array<{
            id: string;
            event_type: string;
            payload: Prisma.JsonValue;
          }>
        >`
          SELECT id, event_type, payload
          FROM ops.outbox_events
          WHERE status = 'pending'::ops."OutboxStatus"
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;

        let notified = 0;
        for (const row of claimed) {
          try {
            const payload =
              typeof row.payload === 'string'
                ? (JSON.parse(row.payload) as Record<string, unknown>)
                : ((row.payload as Record<string, unknown>) ?? {});

            const branchId =
              typeof payload.branchId === 'string' ? payload.branchId : null;
            const organizationId =
              typeof payload.organizationId === 'string'
                ? payload.organizationId
                : null;

            if (row.event_type === 'inventory.low_stock' && branchId) {
              this.realtime.emitLowStock(branchId, payload);
            }

            if (DASHBOARD_INVALIDATING_EVENTS.has(row.event_type)) {
              await this.cache.invalidateDashboard(organizationId, branchId);
            }

            // NotificationsService uses root prisma — OK for idempotent creates
            const notifyResult = await this.notifications.dispatchOutboxEvent({
              outboxEventId: row.id,
              eventType: row.event_type,
              payload,
            });
            notified += notifyResult.created;

            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'published', publishedAt: new Date() },
            });
            published.push({
              id: row.id,
              event_type: row.event_type,
              payload,
            });
          } catch (err) {
            this.logger.error(
              `Outbox dispatch failed ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                status: 'failed',
                retryCount: { increment: 1 },
              },
            });
          }
        }

        return { claimed: claimed.length, notified };
      },
      { timeout: 60_000 },
    );

    for (const row of published) {
      this.bus.publish({
        outboxEventId: row.id,
        eventType: row.event_type,
        payload: row.payload,
      });
    }

    return result;
  }
}
