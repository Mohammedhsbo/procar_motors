import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Labour catalogue for the workshop — the priced services a job can contain. */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: boolean;
    },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);

    const where: Prisma.ServiceWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getById(organizationId: string, id: string) {
    return this.toDto(await this.findOrFail(organizationId, id));
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      code: string;
      nameEn: string;
      nameAr: string;
      laborPrice: number;
      durationMinutes: number;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.service.findFirst({
      where: { organizationId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: `A service with code ${dto.code} already exists`,
      });
    }

    const created = await this.prisma.service.create({
      data: {
        organizationId,
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        laborPrice: dto.laborPrice,
        durationMinutes: dto.durationMinutes,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: 'service.create',
      entity: 'Service',
      entityId: created.id,
      after: created,
    });
    return this.toDto(created);
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      nameEn?: string;
      nameAr?: string;
      laborPrice?: number;
      durationMinutes?: number;
      isActive?: boolean;
    },
  ) {
    const before = await this.findOrFail(organizationId, id);

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
        ...(dto.nameAr === undefined ? {} : { nameAr: dto.nameAr }),
        ...(dto.laborPrice === undefined ? {} : { laborPrice: dto.laborPrice }),
        ...(dto.durationMinutes === undefined
          ? {}
          : { durationMinutes: dto.durationMinutes }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: 'service.update',
      entity: 'Service',
      entityId: id,
      before,
      after: updated,
    });
    return this.toDto(updated);
  }

  /** Soft delete — historic quotations and invoices keep pointing at it. */
  async remove(organizationId: string, actorId: string, id: string) {
    const before = await this.findOrFail(organizationId, id);
    const removed = await this.prisma.service.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: 'service.delete',
      entity: 'Service',
      entityId: id,
      before,
      after: removed,
    });
    return { id, deleted: true };
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.service.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Service not found',
      });
    }
    return row;
  }

  private toDto(s: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    laborPrice: Prisma.Decimal;
    durationMinutes: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      code: s.code,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      laborPrice: Number(s.laborPrice),
      durationMinutes: s.durationMinutes,
      isActive: s.isActive,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
