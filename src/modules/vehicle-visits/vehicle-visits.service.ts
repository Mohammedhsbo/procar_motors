import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerStatus,
  FuelType,
  Priority,
  Prisma,
  TransmissionType,
  VisitStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { normalizePlate } from '../../common/utils/plate.util';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { WorkshopRealtimeService } from '../../infrastructure/realtime/workshop-realtime.service';
import { VisitStateMachineService } from './visit-state-machine.service';
import type { AuthUserContext } from '../auth/auth.types';

export type CheckInDto = {
  customerId?: string;
  vehicleId?: string;
  newCustomer?: {
    nameEn: string;
    nameAr: string;
    phone: string;
    whatsapp?: string;
    email?: string;
    status?: CustomerStatus;
  };
  newVehicle?: {
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
  };
  mileage: number;
  fuelLevelPct: number;
  exteriorCondition?: string;
  complaint: string;
  priority: Priority;
  expectedDeliveryAt: string;
  advisorId?: string;
  notes?: string;
  damagePoints?: Array<{
    xPct: number;
    yPct: number;
    labelEn: string;
    labelAr: string;
    severity?: string;
  }>;
};

@Injectable()
export class VehicleVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly stateMachine: VisitStateMachineService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly realtime: WorkshopRealtimeService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: VisitStatus;
      priority?: Priority;
      branchId?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const scopedBranch = query.branchId ?? branchId;

    const where: Prisma.VehicleVisitWhereInput = {
      organizationId,
      branchId: scopedBranch,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.vehicleVisit.count({ where }),
      this.prisma.vehicleVisit.findMany({
        where,
        orderBy: { checkedInAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.visitInclude(),
      }),
    ]);

    return {
      data: rows.map((v) => this.toVisitDto(v)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    const visit = await this.findVisitOrFail(organizationId, id);
    return this.toVisitDto(visit);
  }

  async checkIn(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: CheckInDto,
  ) {
    this.validateCheckInPayload(dto);

    const result = await this.prisma.$transaction(async (tx) => {
      const customerId = await this.resolveCustomer(
        tx,
        organizationId,
        actorId,
        dto,
      );
      const vehicleId = await this.resolveVehicle(
        tx,
        organizationId,
        actorId,
        customerId,
        dto,
      );

      const vehicle = await tx.vehicle.findFirstOrThrow({
        where: { id: vehicleId, organizationId, deletedAt: null },
      });
      if (vehicle.customerId !== customerId) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Vehicle does not belong to the selected customer',
        });
      }

      // Reject duplicate same-day check-in for same plate (architecture §21)
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dup = await tx.vehicleVisit.findFirst({
        where: {
          organizationId,
          vehicleId,
          deletedAt: null,
          checkedInAt: { gte: dayStart },
          status: { not: 'completed' },
        },
      });
      if (dup) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Vehicle already has an active visit today',
        });
      }

      if (dto.mileage !== undefined) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { mileageCurrent: dto.mileage, updatedBy: actorId },
        });
      }

      const jtNumber = await this.sequences.nextInTx(tx, organizationId, 'JT');

      const visit = await tx.vehicleVisit.create({
        data: {
          organizationId,
          branchId,
          customerId,
          vehicleId,
          status: 'waiting',
          priority: dto.priority,
          advisorId: dto.advisorId ?? actorId,
          mileageIn: dto.mileage,
          fuelLevelPct: dto.fuelLevelPct,
          exteriorCondition: dto.exteriorCondition,
          complaint: dto.complaint,
          expectedDeliveryAt: new Date(dto.expectedDeliveryAt),
          notes: dto.notes,
          progressPct: 0,
          version: 1,
          createdBy: actorId,
          updatedBy: actorId,
          damagePoints: dto.damagePoints?.length
            ? {
                create: dto.damagePoints.map((p) => ({
                  xPct: p.xPct,
                  yPct: p.yPct,
                  labelEn: p.labelEn,
                  labelAr: p.labelAr,
                  severity: p.severity,
                })),
              }
            : undefined,
          jobTicket: {
            create: {
              organizationId,
              branchId,
              number: jtNumber,
              advisorId: dto.advisorId ?? actorId,
              status: 'open',
              createdBy: actorId,
            },
          },
        },
        include: this.visitInclude(),
      });

      await this.events.emit(
        'vehicle.visit.created',
        {
          visitId: visit.id,
          organizationId,
          branchId,
          customerId,
          vehicleId,
          ticketNumber: jtNumber,
        },
        tx,
      );

      return visit;
    });

    const dtoResult = this.toVisitDto(result);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'visit.check_in',
      entity: 'VehicleVisit',
      entityId: result.id,
      after: dtoResult,
    });

    return dtoResult;
  }

  async transition(
    organizationId: string,
    actorId: string,
    id: string,
    dto: { status: VisitStatus; version: number; reason?: string },
  ) {
    const current = await this.prisma.vehicleVisit.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }

    if (!this.stateMachine.canTransition(current.status, dto.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Invalid visit status transition: ${current.status} → ${dto.status}`,
        details: { from: current.status, to: dto.status },
      });
    }

    // Hard rule: cannot reach readyForDelivery or completed without QC pass
    if (dto.status === 'readyForDelivery' || dto.status === 'completed') {
      const passed = await this.prisma.qualityCheck.findFirst({
        where: { visitId: id, status: 'passed' },
      });
      if (!passed) {
        throw new ConflictException({
          code: ErrorCodes.QC_REQUIRED,
          message: 'QC pass is required before readyForDelivery / delivery',
        });
      }
    }

    // Payment gate for completed (use /deliver for override path)
    if (dto.status === 'completed') {
      await this.assertPaymentPolicy(organizationId, id);
    }

    if (dto.version !== current.version) {
      throw new ConflictException({
        code: ErrorCodes.OPTIMISTIC_LOCK,
        message: 'Visit was modified by another request',
        details: { expected: dto.version, actual: current.version },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.vehicleVisit.updateMany({
        where: { id, version: dto.version },
        data: {
          status: dto.status,
          version: { increment: 1 },
          updatedBy: actorId,
          ...(dto.status === 'completed'
            ? {
                completedAt: new Date(),
                deliveredAt: new Date(),
                progressPct: 100,
              }
            : {}),
        },
      });
      if (rows.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Visit was modified by another request',
        });
      }

      await this.events.emit(
        'vehicle.status.changed',
        {
          visitId: id,
          from: current.status,
          to: dto.status,
          reason: dto.reason ?? null,
        },
        tx,
      );

      return tx.vehicleVisit.findFirstOrThrow({
        where: { id },
        include: this.visitInclude(),
      });
    });

    const after = this.toVisitDto(updated);
    await this.audit.log({
      organizationId,
      branchId: updated.branchId,
      actorId,
      action: 'visit.transition',
      entity: 'VehicleVisit',
      entityId: id,
      before: { status: current.status, version: current.version },
      after: { status: updated.status, version: updated.version },
    });
    this.realtime.emitVisitStatusChanged({
      branchId: updated.branchId,
      visitId: id,
      from: current.status,
      to: updated.status,
      reason: dto.reason ?? null,
    });
    return after;
  }

  /**
   * Deliver vehicle: readyForDelivery → completed.
   * Default OQ-05: require issued invoice(s) fully paid.
   * Manager override with audit when overridePayment=true.
   */
  async deliver(
    organizationId: string,
    actorId: string,
    user: AuthUserContext,
    id: string,
    dto: {
      version: number;
      overridePayment?: boolean;
      overrideReason?: string;
    },
  ) {
    const current = await this.prisma.vehicleVisit.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: this.visitInclude(),
    });
    if (!current) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    if (current.status !== 'readyForDelivery') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Deliver requires readyForDelivery (got ${current.status})`,
      });
    }
    if (dto.version !== current.version) {
      throw new ConflictException({
        code: ErrorCodes.OPTIMISTIC_LOCK,
        message: 'Visit was modified by another request',
        details: { expected: dto.version, actual: current.version },
      });
    }

    const passed = await this.prisma.qualityCheck.findFirst({
      where: { visitId: id, status: 'passed' },
    });
    if (!passed) {
      throw new ConflictException({
        code: ErrorCodes.QC_REQUIRED,
        message: 'QC pass is required before delivery',
      });
    }

    const payment = await this.invoices.visitOutstanding(organizationId, id);
    let paymentOverridden = false;
    if (!payment.fullyPaid) {
      if (dto.overridePayment) {
        this.assertCanOverridePayment(user);
        if (!dto.overrideReason?.trim()) {
          throw new BadRequestException({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'overrideReason is required when overriding payment',
          });
        }
        paymentOverridden = true;
      } else {
        throw new ConflictException({
          code: ErrorCodes.PAYMENT_REQUIRED,
          message:
            'Payment required before delivery (issue and pay invoice, or manager override)',
          details: payment,
        });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.vehicleVisit.updateMany({
        where: { id, version: dto.version, status: 'readyForDelivery' },
        data: {
          status: 'completed',
          version: { increment: 1 },
          updatedBy: actorId,
          completedAt: new Date(),
          deliveredAt: new Date(),
          progressPct: 100,
        },
      });
      if (rows.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Visit was modified by another request',
        });
      }
      await this.events.emit(
        'vehicle.delivered',
        {
          organizationId,
          branchId: current.branchId,
          visitId: id,
          paymentOverridden,
          outstanding: payment.outstanding,
        },
        tx,
      );
      await this.events.emit(
        'vehicle.status.changed',
        {
          visitId: id,
          from: 'readyForDelivery',
          to: 'completed',
          reason: paymentOverridden
            ? `payment_override: ${dto.overrideReason}`
            : 'delivered',
        },
        tx,
      );
      return tx.vehicleVisit.findFirstOrThrow({
        where: { id },
        include: this.visitInclude(),
      });
    });

    const after = this.toVisitDto(updated);
    await this.audit.log({
      organizationId,
      branchId: updated.branchId,
      actorId,
      action: paymentOverridden
        ? 'visit.deliver.payment_override'
        : 'visit.deliver',
      entity: 'VehicleVisit',
      entityId: id,
      before: { status: current.status, version: current.version },
      after: {
        status: updated.status,
        version: updated.version,
        paymentOverridden,
        overrideReason: dto.overrideReason ?? null,
        payment,
      },
    });
    this.realtime.emitVisitStatusChanged({
      branchId: updated.branchId,
      visitId: id,
      from: 'readyForDelivery',
      to: 'completed',
      reason: paymentOverridden ? 'payment_override' : 'delivered',
    });
    return after;
  }

  private async assertPaymentPolicy(organizationId: string, visitId: string) {
    const payment = await this.invoices.visitOutstanding(
      organizationId,
      visitId,
    );
    if (!payment.fullyPaid) {
      throw new ConflictException({
        code: ErrorCodes.PAYMENT_REQUIRED,
        message:
          'Payment required before delivery — use POST /vehicle-visits/:id/deliver',
        details: payment,
      });
    }
  }

  private assertCanOverridePayment(user: AuthUserContext) {
    // Locked OQ-05: only these roles or invoices.manage
    const privileged = user.roles.some((r) =>
      [
        'super_admin',
        'branch_admin',
        'workshop_manager',
        'accountant',
      ].includes(r),
    );
    if (privileged || user.permissions.includes('invoices.manage')) {
      return;
    }
    throw new ForbiddenException({
      code: ErrorCodes.FORBIDDEN,
      message: 'Not allowed to override payment policy',
    });
  }

  private validateCheckInPayload(dto: CheckInDto) {
    const hasCustomer = Boolean(dto.customerId) || Boolean(dto.newCustomer);
    const hasVehicle = Boolean(dto.vehicleId) || Boolean(dto.newVehicle);
    if (!hasCustomer) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'customerId or newCustomer is required',
      });
    }
    if (!hasVehicle) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'vehicleId or newVehicle is required',
      });
    }
    if (!dto.complaint?.trim()) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'complaint is required',
      });
    }
    if (dto.fuelLevelPct < 0 || dto.fuelLevelPct > 100) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'fuelLevelPct must be between 0 and 100',
      });
    }
    if (!dto.expectedDeliveryAt) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'expectedDeliveryAt is required',
      });
    }
  }

  private async resolveCustomer(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorId: string,
    dto: CheckInDto,
  ) {
    if (dto.customerId) {
      const existing = await tx.customer.findFirst({
        where: { id: dto.customerId, organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Customer not found',
        });
      }
      return existing.id;
    }

    const nc = dto.newCustomer!;
    try {
      const created = await tx.customer.create({
        data: {
          organizationId,
          nameEn: nc.nameEn,
          nameAr: nc.nameAr,
          phone: nc.phone.trim(),
          whatsapp: nc.whatsapp?.trim() ?? nc.phone.trim(),
          email: nc.email,
          status: nc.status ?? 'active',
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return created.id;
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

  private async resolveVehicle(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorId: string,
    customerId: string,
    dto: CheckInDto,
  ) {
    if (dto.vehicleId) {
      const existing = await tx.vehicle.findFirst({
        where: { id: dto.vehicleId, organizationId, deletedAt: null },
      });
      if (!existing) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Vehicle not found',
        });
      }
      return existing.id;
    }

    const nv = dto.newVehicle!;
    const plateNormalized = normalizePlate(nv.plate);
    try {
      const created = await tx.vehicle.create({
        data: {
          organizationId,
          customerId,
          plate: nv.plate.trim(),
          plateNormalized,
          vin: nv.vin?.trim() || null,
          engineNumber: nv.engineNumber?.trim() || null,
          make: nv.make.trim(),
          model: nv.model.trim(),
          year: nv.year,
          color: nv.color,
          fuelType: nv.fuelType,
          transmission: nv.transmission,
          mileageCurrent: nv.mileageCurrent ?? dto.mileage,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return created.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Plate or VIN already exists for this organization',
        });
      }
      throw e;
    }
  }

  private visitInclude() {
    return {
      customer: true,
      vehicle: true,
      branch: true,
      jobTicket: {
        include: {
          workOrders: {
            orderBy: { createdAt: 'desc' as const },
            take: 1,
          },
        },
      },
      damagePoints: true,
      invoices: {
        where: { status: { notIn: ['draft', 'cancelled'] as never[] } },
        select: { total: true, amountPaid: true, status: true },
      },
    } satisfies Prisma.VehicleVisitInclude;
  }

  private async findVisitOrFail(organizationId: string, id: string) {
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: this.visitInclude(),
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    return visit;
  }

  private toVisitDto(
    visit: Prisma.VehicleVisitGetPayload<{
      include: ReturnType<VehicleVisitsService['visitInclude']>;
    }>,
  ) {
    const ticket = visit.jobTicket?.number ?? null;
    const wo = visit.jobTicket?.workOrders[0]?.number ?? null;
    const amount = visit.invoices.reduce((s, i) => s + Number(i.total), 0);
    const paid =
      visit.invoices.length > 0 &&
      visit.invoices.every((i) => i.status === 'paid');
    const elapsedMs = Date.now() - visit.checkedInAt.getTime();
    const hours = Math.floor(elapsedMs / 3_600_000);
    const mins = Math.floor((elapsedMs % 3_600_000) / 60_000);

    return {
      id: visit.id,
      version: visit.version,
      ticket,
      wo,
      customer: visit.customer.nameEn,
      customerAr: visit.customer.nameAr,
      phone: visit.customer.phone,
      vehicle: `${visit.vehicle.make} ${visit.vehicle.model}`,
      vehicleAr: `${visit.vehicle.make} ${visit.vehicle.model}`,
      year: visit.vehicle.year,
      plate: visit.vehicle.plate,
      advisor: null as string | null,
      advisorAr: null as string | null,
      technician: null as string | null,
      technicianAr: null as string | null,
      status: visit.status,
      entry: visit.checkedInAt.toISOString(),
      expected: visit.expectedDeliveryAt?.toISOString() ?? null,
      priority: visit.priority,
      progress: visit.progressPct,
      branch: visit.branch.code,
      elapsed: `${hours}h ${mins}m`,
      amount,
      paid,
      // Structured fields (OQ-07 + ids)
      customerId: visit.customerId,
      vehicleId: visit.vehicleId,
      branchId: visit.branchId,
      jobTicketId: visit.jobTicket?.id ?? null,
      customerNameEn: visit.customer.nameEn,
      customerNameAr: visit.customer.nameAr,
      complaint: visit.complaint,
      mileageIn: visit.mileageIn,
      fuelLevelPct: visit.fuelLevelPct,
      exteriorCondition: visit.exteriorCondition,
      notes: visit.notes,
      checkedInAt: visit.checkedInAt,
      expectedDeliveryAt: visit.expectedDeliveryAt,
      damagePoints: visit.damagePoints.map((d) => ({
        id: d.id,
        xPct: Number(d.xPct),
        yPct: Number(d.yPct),
        labelEn: d.labelEn,
        labelAr: d.labelAr,
        severity: d.severity,
      })),
    };
  }
}
