import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Job lifecycle. A job may only move forward, or be cancelled. */
const STAGES = [
  'reception',
  'inspection',
  'in_progress',
  'quality',
  'ready',
  'delivered',
] as const;

type Stage = (typeof STAGES)[number];

const EDITABLE_STAGES: string[] = ['reception', 'inspection'];

@Injectable()
export class UxbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly audit: AuditService,
  ) {}

  // ── Catalogue ──────────────────────────────────────────────────────────

  listCategories(organizationId: string) {
    return this.prisma.uxbServiceCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listSizeClasses(organizationId: string) {
    return this.prisma.uxbSizeClass.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listServices(organizationId: string, categoryCode?: string) {
    const rows = await this.prisma.uxbService.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(categoryCode ? { category: { code: categoryCode } } : {}),
      },
      include: {
        category: true,
        prices: { include: { sizeClass: true } },
      },
      orderBy: { code: 'asc' },
    });

    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      description: s.description,
      category: {
        code: s.category.code,
        nameEn: s.category.nameEn,
        nameAr: s.category.nameAr,
      },
      basePrice: Number(s.basePrice),
      durationMin: s.durationMin,
      warrantyMonths: s.warrantyMonths,
      materialPartId: s.materialPartId,
      prices: s.prices.map((p) => ({
        sizeClassId: p.sizeClassId,
        sizeClassCode: p.sizeClass.code,
        price: Number(p.price),
      })),
    }));
  }

  /**
   * Price for a service at a given vehicle size. Falls back to the base price
   * scaled by the size-class multiplier when no explicit price is set.
   */
  async priceFor(
    organizationId: string,
    serviceId: string,
    sizeClassId?: string | null,
  ): Promise<number> {
    const service = await this.prisma.uxbService.findFirst({
      where: { id: serviceId, organizationId },
      include: sizeClassId
        ? { prices: { where: { sizeClassId } } }
        : { prices: false },
    });
    if (!service) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'UXB service not found',
      });
    }

    const explicit = 'prices' in service ? service.prices?.[0] : undefined;
    if (explicit) return Number(explicit.price);

    if (sizeClassId) {
      const sizeClass = await this.prisma.uxbSizeClass.findUnique({
        where: { id: sizeClassId },
      });
      if (sizeClass) {
        return Number(service.basePrice) * Number(sizeClass.multiplier);
      }
    }
    return Number(service.basePrice);
  }

  // ── Jobs ───────────────────────────────────────────────────────────────

  async listJobs(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; stage?: string; search?: string },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.UxbJobWhereInput = {
      organizationId,
      branchId,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { customer: { nameEn: { contains: query.search, mode: 'insensitive' } } },
              { customer: { nameAr: { contains: query.search } } },
              { vehicle: { plate: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.uxbJob.findMany({
        where,
        include: this.jobInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.uxbJob.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toJobDto(r)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Kanban view for the shop floor — jobs grouped by stage. */
  async board(organizationId: string, branchId: string) {
    const jobs = await this.prisma.uxbJob.findMany({
      where: {
        organizationId,
        branchId,
        stage: { notIn: ['delivered', 'cancelled'] },
      },
      include: this.jobInclude(),
      orderBy: { createdAt: 'asc' },
    });

    const dto = jobs.map((j) => this.toJobDto(j));
    return STAGES.map((stage) => ({
      stage,
      jobs: dto.filter((j) => j.stage === stage),
    }));
  }

  async getJob(organizationId: string, id: string) {
    return this.toJobDto(await this.findJobOrFail(organizationId, id));
  }

  async createJob(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      customerId: string;
      vehicleId: string;
      sizeClassId?: string;
      visitId?: string;
      advisorId?: string;
      odometer?: number;
      complaint?: string;
      notes?: string;
      promisedAt?: string;
    },
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, organizationId, deletedAt: null },
    });
    if (!vehicle) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Vehicle not found',
      });
    }
    if (vehicle.customerId !== dto.customerId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Vehicle does not belong to this customer',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'UXB');
      return tx.uxbJob.create({
        data: {
          organizationId,
          branchId,
          number,
          customerId: dto.customerId,
          vehicleId: dto.vehicleId,
          sizeClassId: dto.sizeClassId ?? null,
          visitId: dto.visitId ?? null,
          advisorId: dto.advisorId ?? actorId,
          odometer: dto.odometer ?? null,
          complaint: dto.complaint ?? null,
          notes: dto.notes ?? null,
          promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : null,
          stage: 'reception',
          createdBy: actorId,
        },
        include: this.jobInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'uxb.job.create',
      entity: 'UxbJob',
      entityId: created.id,
      after: created,
    });
    return this.toJobDto(created);
  }

  /** Replaces the service lines and recalculates totals using size pricing. */
  async setJobItems(
    organizationId: string,
    branchId: string,
    actorId: string,
    jobId: string,
    dto: {
      discount?: number;
      taxRatePct?: number;
      items: Array<{
        serviceId: string;
        zone?: string;
        areaSqm?: number;
        qty?: number;
        unitPrice?: number;
        discount?: number;
        technicianId?: string;
      }>;
    },
  ) {
    const job = await this.findJobOrFail(organizationId, jobId);
    if (!EDITABLE_STAGES.includes(job.stage)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Items can only be changed while the job is in ${EDITABLE_STAGES.join(' or ')}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.uxbJobItem.deleteMany({ where: { jobId } });

      let subtotal = 0;
      for (const [index, line] of dto.items.entries()) {
        const unitPrice =
          line.unitPrice ??
          (await this.priceFor(organizationId, line.serviceId, job.sizeClassId));
        const service = await tx.uxbService.findFirst({
          where: { id: line.serviceId, organizationId },
        });
        if (!service) {
          throw new NotFoundException({
            code: ErrorCodes.NOT_FOUND,
            message: 'UXB service not found',
          });
        }

        const qty = Number(line.qty ?? 1);
        const discount = Number(line.discount ?? 0);
        const lineTotal = qty * unitPrice - discount;
        subtotal += lineTotal;

        await tx.uxbJobItem.create({
          data: {
            jobId,
            serviceId: service.id,
            zone: line.zone ?? null,
            areaSqm: line.areaSqm ?? null,
            qty,
            unitPrice,
            discount,
            lineTotal,
            technicianId: line.technicianId ?? null,
            sortOrder: index,
          },
        });

        // Keep the panel map in step with the lines.
        if (line.zone) {
          await tx.uxbJobZone.upsert({
            where: { jobId_panelCode: { jobId, panelCode: line.zone } },
            create: { jobId, panelCode: line.zone, status: 'planned' },
            update: {},
          });
        }
      }

      const jobDiscount = Number(dto.discount ?? 0);
      const taxable = Math.max(subtotal - jobDiscount, 0);
      const tax = Number((taxable * ((dto.taxRatePct ?? 0) / 100)).toFixed(2));

      return tx.uxbJob.update({
        where: { id: jobId },
        data: {
          subtotal,
          discount: jobDiscount,
          tax,
          total: taxable + tax,
        },
        include: this.jobInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'uxb.job.items.update',
      entity: 'UxbJob',
      entityId: jobId,
      after: updated,
    });
    return this.toJobDto(updated);
  }

  /** Moves a job forward one stage, or to a specific later stage. */
  async advanceJob(
    organizationId: string,
    branchId: string,
    actorId: string,
    jobId: string,
    targetStage: string,
  ) {
    const job = await this.findJobOrFail(organizationId, jobId);

    if (targetStage === 'cancelled') {
      const cancelled = await this.prisma.uxbJob.update({
        where: { id: jobId },
        data: { stage: 'cancelled' },
        include: this.jobInclude(),
      });
      return this.toJobDto(cancelled);
    }

    const currentIndex = STAGES.indexOf(job.stage as Stage);
    const targetIndex = STAGES.indexOf(targetStage as Stage);
    if (targetIndex < 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown stage: ${targetStage}`,
      });
    }
    if (targetIndex <= currentIndex) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Job is already at ${job.stage}; stages only move forward`,
      });
    }
    if (targetIndex > currentIndex + 1) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot skip from ${job.stage} to ${targetStage}`,
      });
    }
    if (targetStage !== 'inspection' && job.items.length === 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Add at least one service before starting work',
      });
    }

    const now = new Date();
    const updated = await this.prisma.uxbJob.update({
      where: { id: jobId },
      data: {
        stage: targetStage,
        ...(targetStage === 'in_progress' ? { startedAt: now } : {}),
        ...(targetStage === 'ready' ? { completedAt: now } : {}),
        ...(targetStage === 'delivered' ? { deliveredAt: now } : {}),
      },
      include: this.jobInclude(),
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'uxb.job.stage',
      entity: 'UxbJob',
      entityId: jobId,
      before: { stage: job.stage },
      after: { stage: targetStage },
    });
    return this.toJobDto(updated);
  }

  /**
   * Invoices a finished job into the shared ledger and starts any warranties.
   */
  async invoiceJob(
    organizationId: string,
    branchId: string,
    actorId: string,
    jobId: string,
  ) {
    const job = await this.findJobOrFail(organizationId, jobId);
    if (job.invoiceId) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'This job has already been invoiced',
      });
    }
    if (!['ready', 'delivered'].includes(job.stage)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Only a completed job can be invoiced',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'INV');
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          branchId,
          customerId: job.customerId,
          number,
          sourceApp: 'uxb',
          sourceRefType: 'uxb.job',
          sourceRef: job.id,
          status: 'draft',
          subtotal: job.subtotal,
          discount: job.discount,
          tax: job.tax,
          total: job.total,
          amountPaid: 0,
          createdBy: actorId,
          items: {
            create: job.items.map((i, idx) => ({
              kind: 'film',
              nameEn: i.service.nameEn,
              nameAr: i.service.nameAr,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
              sortOrder: i.sortOrder ?? idx,
            })),
          },
        },
      });

      return tx.uxbJob.update({
        where: { id: job.id },
        data: { invoiceId: invoice.id },
        include: this.jobInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'uxb.job.invoice',
      entity: 'UxbJob',
      entityId: jobId,
      after: updated,
    });
    return this.toJobDto(updated);
  }

  // ── Panel map, readings, rolls ─────────────────────────────────────────

  async setZoneStatus(
    organizationId: string,
    jobId: string,
    panelCode: string,
    dto: { status: string; filmType?: string; notes?: string },
  ) {
    await this.findJobOrFail(organizationId, jobId);
    return this.prisma.uxbJobZone.upsert({
      where: { jobId_panelCode: { jobId, panelCode } },
      create: {
        jobId,
        panelCode,
        status: dto.status,
        filmType: dto.filmType ?? null,
        notes: dto.notes ?? null,
      },
      update: {
        status: dto.status,
        filmType: dto.filmType ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async addPaintReading(
    organizationId: string,
    actorId: string,
    jobId: string,
    dto: { panelCode: string; thicknessUm: number; notes?: string },
  ) {
    await this.findJobOrFail(organizationId, jobId);
    return this.prisma.uxbPaintReading.create({
      data: {
        jobId,
        panelCode: dto.panelCode,
        thicknessUm: dto.thicknessUm,
        notes: dto.notes ?? null,
        recordedBy: actorId,
      },
    });
  }

  listRolls(organizationId: string, branchId: string, status?: string) {
    return this.prisma.uxbMaterialRoll.findMany({
      where: {
        organizationId,
        branchId,
        ...(status ? { status } : {}),
      },
      include: { part: { select: { sku: true, nameEn: true, nameAr: true } } },
      orderBy: { openedAt: 'desc' },
    });
  }

  async openRoll(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      rollNo: string;
      widthCm: number;
      initialM: number;
      supplierId?: string;
      costPerM?: number;
    },
  ) {
    const part = await this.prisma.part.findFirst({
      where: { id: dto.partId, organizationId, deletedAt: null },
    });
    if (!part) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Inventory part not found',
      });
    }

    const roll = await this.prisma.uxbMaterialRoll.create({
      data: {
        organizationId,
        branchId,
        partId: dto.partId,
        rollNo: dto.rollNo,
        widthCm: dto.widthCm,
        initialM: dto.initialM,
        remainingM: dto.initialM,
        supplierId: dto.supplierId ?? null,
        costPerM: dto.costPerM ?? null,
        status: 'open',
      },
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'uxb.roll.open',
      entity: 'UxbMaterialRoll',
      entityId: roll.id,
      after: roll,
    });
    return roll;
  }

  /**
   * Draws metres off a roll for a job line. Refuses to over-consume, and
   * closes the roll when it runs out.
   */
  async consumeRoll(
    organizationId: string,
    actorId: string,
    dto: {
      rollId: string;
      jobItemId: string;
      metersUsed: number;
      wasteM?: number;
    },
  ) {
    if (!(dto.metersUsed > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'metersUsed must be greater than 0',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const roll = await tx.uxbMaterialRoll.findFirst({
        where: { id: dto.rollId, organizationId },
      });
      if (!roll) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Roll not found',
        });
      }

      const draw = dto.metersUsed + Number(dto.wasteM ?? 0);
      const remaining = Number(roll.remainingM) - draw;
      if (remaining < 0) {
        throw new ConflictException({
          code: ErrorCodes.INSUFFICIENT_STOCK,
          message: 'Roll does not have enough material left',
          details: { remainingM: Number(roll.remainingM), requested: draw },
        });
      }

      const consumption = await tx.uxbRollConsumption.create({
        data: {
          rollId: roll.id,
          jobItemId: dto.jobItemId,
          metersUsed: dto.metersUsed,
          wasteM: dto.wasteM ?? 0,
          recordedBy: actorId,
        },
      });

      await tx.uxbMaterialRoll.update({
        where: { id: roll.id },
        data: {
          remainingM: remaining,
          status: remaining === 0 ? 'depleted' : roll.status,
        },
      });

      return consumption;
    });
  }

  /** Material + labour cost against revenue for one job. */
  async jobProfitability(organizationId: string, jobId: string) {
    const job = await this.findJobOrFail(organizationId, jobId);
    const itemIds = job.items.map((i) => i.id);

    const consumption = itemIds.length
      ? await this.prisma.uxbRollConsumption.findMany({
          where: { jobItemId: { in: itemIds } },
          include: { roll: true },
        })
      : [];

    const materialCost = consumption.reduce(
      (sum, c) =>
        sum +
        (Number(c.metersUsed) + Number(c.wasteM)) *
          Number(c.roll.costPerM ?? 0),
      0,
    );
    const wasteMeters = consumption.reduce(
      (sum, c) => sum + Number(c.wasteM),
      0,
    );
    const revenue = Number(job.total);

    return {
      jobId: job.id,
      number: job.number,
      revenue,
      materialCost: Number(materialCost.toFixed(2)),
      wasteMeters: Number(wasteMeters.toFixed(3)),
      grossProfit: Number((revenue - materialCost).toFixed(2)),
      marginPct:
        revenue > 0
          ? Number((((revenue - materialCost) / revenue) * 100).toFixed(1))
          : 0,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async findJobOrFail(organizationId: string, id: string) {
    const job = await this.prisma.uxbJob.findFirst({
      where: { id, organizationId },
      include: this.jobInclude(),
    });
    if (!job) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'UXB job not found',
      });
    }
    return job;
  }

  private jobInclude() {
    return {
      customer: { select: { id: true, nameEn: true, nameAr: true, phone: true } },
      vehicle: {
        select: { id: true, plate: true, make: true, model: true, year: true },
      },
      sizeClass: true,
      items: {
        orderBy: { sortOrder: 'asc' as const },
        include: { service: { include: { category: true } } },
      },
      zones: true,
      readings: { orderBy: { recordedAt: 'desc' as const } },
    };
  }

  private toJobDto(job: {
    id: string;
    number: string;
    stage: string;
    branchId: string;
    customerId: string;
    vehicleId: string;
    sizeClassId: string | null;
    visitId: string | null;
    odometer: number | null;
    complaint: string | null;
    notes: string | null;
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
    invoiceId: string | null;
    promisedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    deliveredAt: Date | null;
    createdAt: Date;
    customer: { id: string; nameEn: string; nameAr: string; phone: string | null } | null;
    vehicle: { id: string; plate: string; make: string; model: string; year: number } | null;
    sizeClass: { id: string; code: string; nameEn: string; nameAr: string } | null;
    items: Array<{
      id: string;
      serviceId: string;
      zone: string | null;
      areaSqm: Prisma.Decimal | null;
      qty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      technicianId: string | null;
      status: string;
      sortOrder: number;
      service: {
        nameEn: string;
        nameAr: string;
        category: { code: string; nameEn: string; nameAr: string };
      };
    }>;
    zones: Array<{ panelCode: string; status: string; filmType: string | null }>;
    readings: Array<{ panelCode: string; thicknessUm: Prisma.Decimal; recordedAt: Date }>;
  }) {
    return {
      id: job.id,
      number: job.number,
      stage: job.stage,
      branchId: job.branchId,
      visitId: job.visitId,
      odometer: job.odometer,
      complaint: job.complaint,
      notes: job.notes,
      subtotal: Number(job.subtotal),
      discount: Number(job.discount),
      tax: Number(job.tax),
      total: Number(job.total),
      invoiceId: job.invoiceId,
      promisedAt: job.promisedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      deliveredAt: job.deliveredAt,
      createdAt: job.createdAt,
      customer: job.customer,
      vehicle: job.vehicle,
      sizeClass: job.sizeClass,
      items: job.items.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        nameEn: i.service.nameEn,
        nameAr: i.service.nameAr,
        category: i.service.category.code,
        zone: i.zone,
        areaSqm: i.areaSqm === null ? null : Number(i.areaSqm),
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discount),
        lineTotal: Number(i.lineTotal),
        technicianId: i.technicianId,
        status: i.status,
        sortOrder: i.sortOrder,
      })),
      zones: job.zones,
      readings: job.readings.map((r) => ({
        panelCode: r.panelCode,
        thicknessUm: Number(r.thicknessUm),
        recordedAt: r.recordedAt,
      })),
    };
  }
}
