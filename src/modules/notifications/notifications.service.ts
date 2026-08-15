import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { WorkshopRealtimeService } from '../../infrastructure/realtime/workshop-realtime.service';
import { routeForEvent } from './notification-routes';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: WorkshopRealtimeService,
  ) {}

  async list(
    userId: string,
    query: { page?: number; limit?: number; unreadOnly?: boolean },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [total, unreadCount, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((n) => this.toDto(n)),
      meta: {
        page,
        limit,
        total,
        unreadCount,
        hasMore: page * limit < total,
      },
    };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Notification not found',
      });
    }
    if (existing.readAt) return this.toDto(existing);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.toDto(updated);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ channel: 'asc' }, { eventKey: 'asc' }],
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        eventKey: r.eventKey,
        enabled: r.enabled,
      })),
    };
  }

  async upsertPreferences(
    userId: string,
    prefs: Array<{ channel: string; eventKey: string; enabled: boolean }>,
  ) {
    for (const p of prefs) {
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_channel_eventKey: {
            userId,
            channel: p.channel,
            eventKey: p.eventKey,
          },
        },
        update: { enabled: p.enabled },
        create: {
          userId,
          channel: p.channel,
          eventKey: p.eventKey,
          enabled: p.enabled,
        },
      });
    }
    return this.getPreferences(userId);
  }

  /**
   * Create in-app notifications for an outbox domain event.
   * Idempotent per user+outboxEventId via body marker.
   */
  async dispatchOutboxEvent(params: {
    outboxEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    const route = routeForEvent(params.eventType);
    if (!route) {
      return { created: 0, skipped: true as const };
    }

    const branchId = params.payload.branchId as string | undefined;
    const organizationId = params.payload.organizationId as string | undefined;

    const users = await this.resolveRecipients({
      roles: route.roles,
      branchId,
      organizationId,
    });

    let created = 0;
    const entityId = route.entityId?.(params.payload) ?? null;
    const titleEn = route.titleEn(params.payload);
    const titleAr = route.titleAr(params.payload);
    const bodyEnBase = route.bodyEn?.(params.payload) ?? null;
    const bodyAr = route.bodyAr?.(params.payload) ?? null;
    const marker = `[outbox:${params.outboxEventId}]`;

    for (const user of users) {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: {
          userId_channel_eventKey: {
            userId: user.id,
            channel: 'in_app',
            eventKey: params.eventType,
          },
        },
      });
      if (pref && !pref.enabled) continue;

      const already = await this.prisma.notification.findFirst({
        where: {
          userId: user.id,
          bodyEn: { contains: marker },
        },
      });
      if (already) continue;

      const notification = await this.prisma.notification.create({
        data: {
          userId: user.id,
          category: route.category,
          titleEn,
          titleAr,
          bodyEn: bodyEnBase ? `${bodyEnBase} ${marker}` : marker,
          bodyAr,
          entityType: route.entityType ?? null,
          entityId,
        },
      });
      created += 1;
      this.realtime.emitNotification(user.id, {
        id: notification.id,
        category: notification.category,
        titleEn: notification.titleEn,
        titleAr: notification.titleAr,
        entityType: notification.entityType,
        entityId: notification.entityId,
        createdAt: notification.createdAt,
      });
    }

    return { created, skipped: false as const };
  }

  private async resolveRecipients(params: {
    roles: string[];
    branchId?: string;
    organizationId?: string;
  }) {
    return this.prisma.user.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        userType: 'staff',
        ...(params.organizationId
          ? { organizationId: params.organizationId }
          : {}),
        roles: {
          some: {
            role: { key: { in: params.roles } },
          },
        },
        ...(params.branchId
          ? {
              OR: [
                { roles: { some: { role: { key: 'super_admin' } } } },
                { branches: { some: { branchId: params.branchId } } },
              ],
            }
          : {}),
      },
      select: { id: true },
    });
  }

  private toDto(n: {
    id: string;
    category: string;
    titleEn: string;
    titleAr: string;
    bodyEn: string | null;
    bodyAr: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: n.id,
      category: n.category,
      titleEn: n.titleEn,
      titleAr: n.titleAr,
      bodyEn: n.bodyEn?.replace(/\s*\[outbox:[^\]]+\]\s*$/, '') ?? null,
      bodyAr: n.bodyAr,
      entityType: n.entityType,
      entityId: n.entityId,
      readAt: n.readAt,
      unread: !n.readAt,
      createdAt: n.createdAt,
    };
  }
}
