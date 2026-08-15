import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InspectionTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, activeOnly = true) {
    const templates = await this.prisma.inspectionTemplate.findMany({
      where: {
        organizationId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    return templates.map((t) => this.toDto(t));
  }

  async getById(organizationId: string, id: string) {
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Inspection template not found',
      });
    }
    return this.toDto(template);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      code: string;
      nameEn: string;
      nameAr: string;
      version?: number;
      items: Array<{
        nameEn: string;
        nameAr: string;
        category?: string;
        sortOrder?: number;
        requiresMeasurement?: boolean;
      }>;
    },
  ) {
    const version = dto.version ?? 1;
    const template = await this.prisma.inspectionTemplate.create({
      data: {
        organizationId,
        code: dto.code,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        version,
        isActive: true,
        items: {
          create: dto.items.map((item, idx) => ({
            nameEn: item.nameEn,
            nameAr: item.nameAr,
            category: item.category,
            sortOrder: item.sortOrder ?? idx + 1,
            requiresMeasurement: item.requiresMeasurement ?? false,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    const result = this.toDto(template);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'inspection_template.create',
      entity: 'InspectionTemplate',
      entityId: template.id,
      after: result,
    });
    return result;
  }

  private toDto(
    t: Prisma.InspectionTemplateGetPayload<{
      include: { items: true };
    }>,
  ) {
    return {
      id: t.id,
      code: t.code,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      version: t.version,
      isActive: t.isActive,
      items: t.items.map((i) => ({
        id: i.id,
        category: i.category,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        sortOrder: i.sortOrder,
        requiresMeasurement: i.requiresMeasurement,
      })),
    };
  }
}
