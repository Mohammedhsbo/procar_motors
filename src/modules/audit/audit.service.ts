import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    organizationId: string;
    branchId?: string | null;
    actorId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
    requestId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    return this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        branchId: params.branchId ?? null,
        actorId: params.actorId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        before:
          params.before === undefined
            ? undefined
            : (params.before as Prisma.InputJsonValue),
        after:
          params.after === undefined
            ? undefined
            : (params.after as Prisma.InputJsonValue),
        metadata:
          params.metadata === undefined
            ? undefined
            : (params.metadata as Prisma.InputJsonValue),
        requestId: params.requestId ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  }

  async list(params: {
    organizationId: string;
    branchId?: string;
    entity?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const where: Prisma.AuditLogWhereInput = {
      organizationId: params.organizationId,
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.entity ? { entity: params.entity } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }
}
