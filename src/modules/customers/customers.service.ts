import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      status?: CustomerStatus;
      q?: string;
      sortBy?: 'nameEn' | 'createdAt' | 'updatedAt';
      sortDir?: 'asc' | 'desc';
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const sortBy = query.sortBy ?? 'nameEn';
    const sortDir = query.sortDir ?? 'asc';

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { nameEn: { contains: query.q, mode: 'insensitive' } },
              { nameAr: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
              { whatsapp: { contains: query.q } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              vehicles: { where: { deletedAt: null } },
              visits: { where: { deletedAt: null } },
            },
          },
          visits: {
            where: { deletedAt: null },
            orderBy: { checkedInAt: 'desc' },
            take: 1,
            select: { checkedInAt: true },
          },
          invoices: {
            where: { status: { notIn: ['draft', 'cancelled'] } },
            select: { total: true },
          },
        },
      }),
    ]);

    return {
      data: rows.map((c) => this.toListDto(c)),
      meta: {
        page,
        limit,
        total,
        hasMore: page * limit < total,
      },
    };
  }

  async getById(organizationId: string, id: string) {
    const customer = await this.findOrFail(organizationId, id);
    const [vehiclesCount, visitsCount, spendAgg, lastVisit] = await Promise.all(
      [
        this.prisma.vehicle.count({
          where: { customerId: id, deletedAt: null },
        }),
        this.prisma.vehicleVisit.count({
          where: { customerId: id, deletedAt: null },
        }),
        this.prisma.invoice.aggregate({
          where: {
            customerId: id,
            status: { notIn: ['draft', 'cancelled'] },
          },
          _sum: { total: true },
        }),
        this.prisma.vehicleVisit.findFirst({
          where: { customerId: id, deletedAt: null },
          orderBy: { checkedInAt: 'desc' },
          select: { checkedInAt: true },
        }),
      ],
    );

    return {
      ...this.toBaseDto(customer),
      vehiclesCount,
      visitsCount,
      spend: Number(spendAgg._sum.total ?? 0),
      lastVisitAt: lastVisit?.checkedInAt ?? null,
    };
  }

  async listVehicles(organizationId: string, customerId: string) {
    await this.findOrFail(organizationId, customerId);
    const vehicles = await this.prisma.vehicle.findMany({
      where: { organizationId, customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      plateNormalized: v.plateNormalized,
      vin: v.vin,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      fuelType: v.fuelType,
      transmission: v.transmission,
      mileageCurrent: v.mileageCurrent,
      status: v.status,
    }));
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      nameEn: string;
      nameAr: string;
      phone: string;
      whatsapp?: string;
      email?: string;
      status?: CustomerStatus;
      notes?: string;
      preferredBranchId?: string;
      code?: string;
    },
  ) {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          organizationId,
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          phone: dto.phone.trim(),
          whatsapp: dto.whatsapp?.trim() ?? dto.phone.trim(),
          email: dto.email?.trim() || null,
          status: dto.status ?? 'active',
          notes: dto.notes,
          preferredBranchId: dto.preferredBranchId,
          code: dto.code,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      const result = this.toBaseDto(customer);
      await this.audit.log({
        organizationId,
        actorId,
        action: 'customer.create',
        entity: 'Customer',
        entityId: customer.id,
        after: result,
      });
      return result;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Phone already exists for this organization',
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
      phone?: string;
      whatsapp?: string;
      email?: string;
      status?: CustomerStatus;
      notes?: string;
      preferredBranchId?: string | null;
      code?: string;
    },
  ) {
    const before = await this.findOrFail(organizationId, id);
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          phone: dto.phone?.trim(),
          whatsapp: dto.whatsapp?.trim(),
          email:
            dto.email === undefined ? undefined : dto.email?.trim() || null,
          status: dto.status,
          notes: dto.notes,
          preferredBranchId: dto.preferredBranchId,
          code: dto.code,
          updatedBy: actorId,
        },
      });
      const after = this.toBaseDto(customer);
      await this.audit.log({
        organizationId,
        actorId,
        action: 'customer.update',
        entity: 'Customer',
        entityId: id,
        before: this.toBaseDto(before),
        after,
      });
      return after;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Phone already exists for this organization',
        });
      }
      throw e;
    }
  }

  private async findOrFail(organizationId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Customer not found',
      });
    }
    return customer;
  }

  private toBaseDto(c: {
    id: string;
    code: string | null;
    nameEn: string;
    nameAr: string;
    phone: string;
    whatsapp: string | null;
    email: string | null;
    status: CustomerStatus;
    notes: string | null;
    preferredBranchId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: c.id,
      code: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      phone: c.phone,
      whatsapp: c.whatsapp,
      email: c.email,
      status: c.status,
      notes: c.notes,
      preferredBranchId: c.preferredBranchId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private toListDto(c: {
    id: string;
    code: string | null;
    nameEn: string;
    nameAr: string;
    phone: string;
    whatsapp: string | null;
    email: string | null;
    status: CustomerStatus;
    notes: string | null;
    preferredBranchId: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { vehicles: number; visits: number };
    visits: Array<{ checkedInAt: Date }>;
    invoices: Array<{ total: Prisma.Decimal }>;
  }) {
    const spend = c.invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    return {
      ...this.toBaseDto(c),
      vehiclesCount: c._count.vehicles,
      visitsCount: c._count.visits,
      spend,
      lastVisitAt: c.visits[0]?.checkedInAt ?? null,
    };
  }
}
