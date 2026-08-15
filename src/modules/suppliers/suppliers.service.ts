import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, SupplierStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      q?: string;
      status?: SupplierStatus;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.SupplierWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { nameEn: { contains: query.q, mode: 'insensitive' } },
              { nameAr: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { taxId: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: { nameEn: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((s) => this.toDto(s)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    return this.toDto(await this.findOrFail(organizationId, id));
  }

  async create(
    organizationId: string,
    actorId: string,
    branchId: string | undefined,
    dto: {
      nameEn: string;
      nameAr: string;
      phone?: string;
      email?: string;
      taxId?: string;
      status?: SupplierStatus;
    },
  ) {
    const created = await this.prisma.supplier.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        phone: dto.phone,
        email: dto.email,
        taxId: dto.taxId,
        status: dto.status ?? 'active',
      },
    });
    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId: branchId ?? null,
      actorId,
      action: 'supplier.create',
      entity: 'Supplier',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  async update(
    organizationId: string,
    actorId: string,
    branchId: string | undefined,
    id: string,
    dto: {
      nameEn?: string;
      nameAr?: string;
      phone?: string | null;
      email?: string | null;
      taxId?: string | null;
      status?: SupplierStatus;
    },
  ) {
    const existing = await this.findOrFail(organizationId, id);
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: branchId ?? null,
      actorId,
      action: 'supplier.update',
      entity: 'Supplier',
      entityId: id,
      before: this.toDto(existing),
      after: result,
    });
    return result;
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.supplier.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Supplier not found',
      });
    }
    return row;
  }

  async assertActive(organizationId: string, id: string) {
    const row = await this.findOrFail(organizationId, id);
    if (row.status !== 'active') {
      throw new ConflictException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Supplier is ${row.status}`,
      });
    }
    return row;
  }

  toDto(s: {
    id: string;
    organizationId: string;
    nameEn: string;
    nameAr: string;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    rating: Prisma.Decimal | null;
    balance: Prisma.Decimal;
    status: SupplierStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      organizationId: s.organizationId,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      phone: s.phone,
      email: s.email,
      taxId: s.taxId,
      rating: s.rating != null ? Number(s.rating) : null,
      balance: Number(s.balance),
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
