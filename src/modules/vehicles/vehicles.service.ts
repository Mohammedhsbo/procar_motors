import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FuelType,
  Prisma,
  TransmissionType,
  VisitStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { normalizePlate } from '../../common/utils/plate.util';
import { AuditService } from '../audit/audit.service';

const OPEN_VISIT_STATUSES: VisitStatus[] = [
  'waiting',
  'inspection',
  'waitingApproval',
  'readyForRepair',
  'inProgress',
  'waitingParts',
  'qualityCheck',
  'readyForDelivery',
];

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      customerId?: string;
      q?: string;
      sortBy?: 'plate' | 'make' | 'year' | 'createdAt';
      sortDir?: 'asc' | 'desc';
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';
    const q = query.q?.trim();

    const where: Prisma.VehicleWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(q
        ? {
            OR: [
              { plate: { contains: q, mode: 'insensitive' } },
              { plateNormalized: { contains: normalizePlate(q) } },
              { vin: { contains: q, mode: 'insensitive' } },
              { make: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: {
            select: {
              id: true,
              nameEn: true,
              nameAr: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((v) => this.toListDto(v)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        customer: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            phone: true,
            whatsapp: true,
            status: true,
          },
        },
        warranties: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!vehicle) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Vehicle not found',
      });
    }

    const [
      totalVisits,
      openIssues,
      lastVisit,
      spendAgg,
      attachments,
      auditLogs,
    ] = await Promise.all([
      this.prisma.vehicleVisit.count({
        where: { vehicleId: id, deletedAt: null },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          vehicleId: id,
          deletedAt: null,
          status: { in: OPEN_VISIT_STATUSES },
        },
      }),
      this.prisma.vehicleVisit.findFirst({
        where: { vehicleId: id, deletedAt: null },
        orderBy: { checkedInAt: 'desc' },
        select: {
          id: true,
          status: true,
          checkedInAt: true,
          completedAt: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          visit: { vehicleId: id },
          status: { notIn: ['draft', 'cancelled'] },
        },
        _sum: { total: true },
      }),
      this.prisma.attachment.findMany({
        where: {
          organizationId,
          entityType: 'Vehicle',
          entityId: id,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.auditLog.findMany({
        where: {
          organizationId,
          entity: 'Vehicle',
          entityId: id,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const documents = attachments.filter(
      (a) => a.kind === 'document' || a.kind === 'pdf',
    );
    const media = attachments.filter(
      (a) => a.kind === 'photo' || a.kind === 'video',
    );

    return {
      overview: this.toBaseDto(vehicle),
      customer: vehicle.customer,
      stats: {
        totalVisits,
        totalSpent: Number(spendAgg._sum.total ?? 0),
        lastServiceAt: lastVisit?.checkedInAt ?? null,
        mileage: vehicle.mileageCurrent,
        openIssues,
      },
      serviceHistory: [] as unknown[],
      documents: documents.map((a) => ({
        id: a.id,
        fileKey: a.fileKey,
        mime: a.mime,
        size: a.size,
        kind: a.kind,
        phase: a.phase,
        createdAt: a.createdAt,
      })),
      media: media.map((a) => ({
        id: a.id,
        fileKey: a.fileKey,
        mime: a.mime,
        size: a.size,
        kind: a.kind,
        phase: a.phase,
        createdAt: a.createdAt,
      })),
      warranties: vehicle.warranties.map((w) => ({
        id: w.id,
        type: w.type,
        description: w.description,
        validUntil: w.validUntil,
        validUntilMileage: w.validUntilMileage,
        createdAt: w.createdAt,
      })),
      maintenance: [] as unknown[],
      activity: auditLogs.map((l) => ({
        id: l.id,
        action: l.action,
        actorId: l.actorId,
        createdAt: l.createdAt,
        before: l.before,
        after: l.after,
      })),
    };
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      customerId: string;
      plate: string;
      vin?: string;
      engineNumber?: string;
      make: string;
      model: string;
      year: number;
      color?: string;
      fuelType?: FuelType;
      transmission?: TransmissionType;
      mileageCurrent?: number;
    },
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: dto.customerId,
        organizationId,
        deletedAt: null,
      },
    });
    if (!customer) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Customer not found in organization',
      });
    }

    const plateNormalized = normalizePlate(dto.plate);
    if (!plateNormalized) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Plate is required',
      });
    }

    try {
      const vehicle = await this.prisma.vehicle.create({
        data: {
          organizationId,
          customerId: dto.customerId,
          plate: dto.plate.trim(),
          plateNormalized,
          vin: dto.vin?.trim() || null,
          engineNumber: dto.engineNumber?.trim() || null,
          make: dto.make.trim(),
          model: dto.model.trim(),
          year: dto.year,
          color: dto.color?.trim() || null,
          fuelType: dto.fuelType,
          transmission: dto.transmission,
          mileageCurrent: dto.mileageCurrent,
          createdBy: actorId,
          updatedBy: actorId,
        },
        include: {
          customer: {
            select: { id: true, nameEn: true, nameAr: true, phone: true },
          },
        },
      });
      const result = this.toListDto(vehicle);
      await this.audit.log({
        organizationId,
        actorId,
        action: 'vehicle.create',
        entity: 'Vehicle',
        entityId: vehicle.id,
        after: result,
      });
      return result;
    } catch (e) {
      this.throwUniqueConflict(e);
    }
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      customerId?: string;
      plate?: string;
      vin?: string | null;
      engineNumber?: string | null;
      make?: string;
      model?: string;
      year?: number;
      color?: string | null;
      fuelType?: FuelType | null;
      transmission?: TransmissionType | null;
      mileageCurrent?: number | null;
      status?: string;
    },
  ) {
    const before = await this.prisma.vehicle.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        customer: {
          select: { id: true, nameEn: true, nameAr: true, phone: true },
        },
      },
    });
    if (!before) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Vehicle not found',
      });
    }

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: dto.customerId,
          organizationId,
          deletedAt: null,
        },
      });
      if (!customer) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Customer not found in organization',
        });
      }
    }

    const plateNormalized = dto.plate ? normalizePlate(dto.plate) : undefined;

    try {
      const vehicle = await this.prisma.vehicle.update({
        where: { id },
        data: {
          customerId: dto.customerId,
          plate: dto.plate?.trim(),
          plateNormalized,
          vin: dto.vin === undefined ? undefined : dto.vin?.trim() || null,
          engineNumber:
            dto.engineNumber === undefined
              ? undefined
              : dto.engineNumber?.trim() || null,
          make: dto.make?.trim(),
          model: dto.model?.trim(),
          year: dto.year,
          color:
            dto.color === undefined ? undefined : dto.color?.trim() || null,
          fuelType: dto.fuelType === undefined ? undefined : dto.fuelType,
          transmission:
            dto.transmission === undefined ? undefined : dto.transmission,
          mileageCurrent: dto.mileageCurrent,
          status: dto.status,
          updatedBy: actorId,
        },
        include: {
          customer: {
            select: { id: true, nameEn: true, nameAr: true, phone: true },
          },
        },
      });
      const after = this.toListDto(vehicle);
      await this.audit.log({
        organizationId,
        actorId,
        action: 'vehicle.update',
        entity: 'Vehicle',
        entityId: id,
        before: this.toListDto(before),
        after,
      });
      return after;
    } catch (e) {
      this.throwUniqueConflict(e);
    }
  }

  private throwUniqueConflict(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const rawTarget = e.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.map(String).join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      const message = target.includes('vin')
        ? 'VIN already exists for this organization'
        : 'Plate already exists for this organization';
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message,
      });
    }
    throw e;
  }

  private toBaseDto(v: {
    id: string;
    customerId: string;
    plate: string;
    plateNormalized: string;
    vin: string | null;
    engineNumber: string | null;
    make: string;
    model: string;
    year: number;
    color: string | null;
    fuelType: FuelType | null;
    transmission: TransmissionType | null;
    mileageCurrent: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: v.id,
      customerId: v.customerId,
      plate: v.plate,
      plateNormalized: v.plateNormalized,
      vin: v.vin,
      engineNumber: v.engineNumber,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      fuelType: v.fuelType,
      transmission: v.transmission,
      mileageCurrent: v.mileageCurrent,
      status: v.status,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  private toListDto(v: {
    id: string;
    customerId: string;
    plate: string;
    plateNormalized: string;
    vin: string | null;
    engineNumber: string | null;
    make: string;
    model: string;
    year: number;
    color: string | null;
    fuelType: FuelType | null;
    transmission: TransmissionType | null;
    mileageCurrent: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    customer: {
      id: string;
      nameEn: string;
      nameAr: string;
      phone: string;
    };
  }) {
    return {
      ...this.toBaseDto(v),
      customer: v.customer,
    };
  }
}
