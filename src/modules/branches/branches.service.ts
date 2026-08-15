import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page = 1, limit = 50) {
    const take = Math.min(100, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;
    const where: Prisma.BranchWhereInput = {
      organizationId,
      deletedAt: null,
    };
    const [total, rows] = await Promise.all([
      this.prisma.branch.count({ where }),
      this.prisma.branch.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take,
      }),
    ]);
    return {
      data: rows.map((b) => this.toDto(b)),
      meta: {
        page: Math.max(1, page),
        limit: take,
        total,
        hasMore: skip + take < total,
      },
    };
  }

  async getById(organizationId: string, id: string) {
    const branch = await this.findOrFail(organizationId, id);
    return this.toDto(branch);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      code: string;
      nameEn: string;
      nameAr: string;
      address?: string;
      phone?: string;
      timezone?: string;
    },
  ) {
    try {
      const branch = await this.prisma.branch.create({
        data: {
          organizationId,
          code: dto.code,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          address: dto.address,
          phone: dto.phone,
          timezone: dto.timezone ?? 'Africa/Cairo',
        },
      });
      await this.audit.log({
        organizationId,
        branchId: branch.id,
        actorId,
        action: 'branch.create',
        entity: 'Branch',
        entityId: branch.id,
        after: this.toDto(branch),
      });
      return this.toDto(branch);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Branch code already exists',
        });
      }
      throw e;
    }
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      nameEn?: string;
      nameAr?: string;
      address?: string;
      phone?: string;
      timezone?: string;
      isActive?: boolean;
    },
  ) {
    const before = await this.findOrFail(organizationId, id);
    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        address: dto.address,
        phone: dto.phone,
        timezone: dto.timezone,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({
      organizationId,
      branchId: branch.id,
      actorId,
      action: 'branch.update',
      entity: 'Branch',
      entityId: branch.id,
      before: this.toDto(before),
      after: this.toDto(branch),
    });
    return this.toDto(branch);
  }

  private async findOrFail(organizationId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Branch not found',
      });
    }
    return branch;
  }

  private toDto(b: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    address: string | null;
    phone: string | null;
    timezone: string;
    isActive: boolean;
  }) {
    return {
      id: b.id,
      code: b.code,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      address: b.address,
      phone: b.phone,
      timezone: b.timezone,
      isActive: b.isActive,
    };
  }
}
