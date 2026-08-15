import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalActorType,
  ApprovalDecision,
  Prisma,
  QuotationItemKind,
  QuotationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { VisitStateMachineService } from '../vehicle-visits/visit-state-machine.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuotationCalculatorService } from './quotation-calculator.service';

const DEFAULT_VALIDITY_DAYS = 7;

export type QuoteItemInput = {
  kind: QuotationItemKind;
  nameEn: string;
  nameAr: string;
  qty: number;
  unitPrice: number;
  partId?: string;
  serviceId?: string;
};

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: QuotationCalculatorService,
    private readonly sequences: NumberSequenceService,
    private readonly stateMachine: VisitStateMachineService,
    private readonly workOrders: WorkOrdersService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: QuotationStatus;
      visitId?: string;
      customerId?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.QuotationWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.visitId ? { visitId: query.visitId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: this.include(),
      }),
    ]);

    return {
      data: rows.map((q) => this.toDto(q)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    const quote = await this.findOrFail(organizationId, id);
    return this.toDto(quote);
  }

  async create(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      visitId: string;
      discount?: number;
      estimatedMinutes?: number;
      items: QuoteItemInput[];
    },
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one quotation item is required',
      });
    }

    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id: dto.visitId, organizationId, deletedAt: null },
      include: { jobTicket: true },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    if (visit.branchId !== branchId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Visit does not belong to the active branch',
      });
    }

    const taxRate = await this.getTaxRate(organizationId);
    const totals = this.calculator.calculate(dto.items, {
      discount: dto.discount ?? 0,
      taxRatePct: taxRate,
    });

    const quote = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'Q');
      return tx.quotation.create({
        data: {
          organizationId,
          branchId,
          visitId: visit.id,
          jobTicketId: visit.jobTicket?.id,
          customerId: visit.customerId,
          vehicleId: visit.vehicleId,
          number,
          version: 1,
          status: 'draft',
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          estimatedMinutes: dto.estimatedMinutes,
          createdBy: actorId,
          items: {
            create: dto.items.map((item, idx) => ({
              kind: item.kind,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              qty: item.qty,
              unitPrice: item.unitPrice,
              lineTotal: totals.lines[idx].lineTotal,
              partId: item.partId,
              serviceId: item.serviceId,
              sortOrder: idx,
            })),
          },
        },
        include: this.include(),
      });
    });

    const result = this.toDto(quote);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'quotation.create',
      entity: 'Quotation',
      entityId: quote.id,
      after: result,
    });
    return result;
  }

  async updateItems(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      discount?: number;
      estimatedMinutes?: number | null;
      items: QuoteItemInput[];
    },
  ) {
    const quote = await this.findOrFail(organizationId, id);
    if (quote.status !== 'draft') {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Only draft quotations can be edited — create a new version',
        details: { status: quote.status },
      });
    }
    if (!dto.items?.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one quotation item is required',
      });
    }

    const taxRate = await this.getTaxRate(organizationId);
    const totals = this.calculator.calculate(dto.items, {
      discount: dto.discount ?? Number(quote.discount),
      taxRatePct: taxRate,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: {
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          estimatedMinutes:
            dto.estimatedMinutes === undefined
              ? undefined
              : dto.estimatedMinutes,
          items: {
            create: dto.items.map((item, idx) => ({
              kind: item.kind,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              qty: item.qty,
              unitPrice: item.unitPrice,
              lineTotal: totals.lines[idx].lineTotal,
              partId: item.partId,
              serviceId: item.serviceId,
              sortOrder: idx,
            })),
          },
        },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.items.update',
      entity: 'Quotation',
      entityId: id,
      after: result,
    });
    return result;
  }

  async send(organizationId: string, actorId: string, id: string) {
    const quote = await this.findOrFail(organizationId, id);
    if (quote.status !== 'draft') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot send quotation in status ${quote.status}`,
      });
    }
    if (!quote.items.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Cannot send an empty quotation',
      });
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + DEFAULT_VALIDITY_DAYS);

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.quotation.updateMany({
        where: { id, status: 'draft' },
        data: {
          status: 'pending',
          sentAt: new Date(),
          validUntil,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quotation was modified by another request',
        });
      }

      // Additional-issue / mid-repair quotes: move visit to waitingApproval on send
      const visit = await tx.vehicleVisit.findFirstOrThrow({
        where: { id: quote.visitId },
      });
      if (
        ['inProgress', 'readyForRepair', 'waitingParts'].includes(
          visit.status,
        ) &&
        this.stateMachine.canTransition(visit.status, 'waitingApproval')
      ) {
        const visitMoved = await tx.vehicleVisit.updateMany({
          where: { id: visit.id, version: visit.version },
          data: {
            status: 'waitingApproval',
            version: { increment: 1 },
            updatedBy: actorId,
          },
        });
        if (visitMoved.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Visit was modified by another request',
          });
        }
        await this.events.emit(
          'vehicle.status.changed',
          {
            visitId: visit.id,
            from: visit.status,
            to: 'waitingApproval',
            reason: 'quotation_sent',
          },
          tx,
        );
      }

      await this.events.emit(
        'quotation.approval.requested',
        {
          quotationId: id,
          visitId: quote.visitId,
          customerId: quote.customerId,
          number: quote.number,
          version: quote.version,
          total: Number(quote.total),
        },
        tx,
      );

      return tx.quotation.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.send',
      entity: 'Quotation',
      entityId: id,
      after: result,
    });
    return {
      ...result,
      visitStatus: updated.visit.status,
    };
  }

  async approve(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { comment?: string; actorType?: ApprovalActorType },
  ) {
    const quote = await this.findOrFail(organizationId, id);
    this.assertPendingNotExpired(quote);

    if (
      !this.stateMachine.canTransition(quote.visit.status, 'readyForRepair')
    ) {
      if (quote.visit.status !== 'readyForRepair') {
        throw new ConflictException({
          code: ErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Visit cannot move from ${quote.visit.status} to readyForRepair`,
        });
      }
    }

    const actorType = dto?.actorType ?? 'staff';
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.quotation.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'approved',
          decidedAt: new Date(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quotation was modified by another request',
        });
      }

      await tx.quotationApproval.create({
        data: {
          quotationId: id,
          actorType,
          actorId,
          decision: 'approve',
          comment: dto?.comment,
        },
      });

      if (quote.visit.status === 'waitingApproval') {
        const visitMoved = await tx.vehicleVisit.updateMany({
          where: { id: quote.visitId, version: quote.visit.version },
          data: {
            status: 'readyForRepair',
            version: { increment: 1 },
            updatedBy: actorId,
            progressPct: 50,
          },
        });
        if (visitMoved.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Visit was modified by another request',
          });
        }
        await this.events.emit(
          'vehicle.status.changed',
          {
            visitId: quote.visitId,
            from: 'waitingApproval',
            to: 'readyForRepair',
          },
          tx,
        );
      }

      const workOrder = await this.workOrders.createFromApprovedQuotationInTx(
        tx,
        {
          organizationId,
          actorId,
          quotation: {
            id: quote.id,
            visitId: quote.visitId,
            jobTicketId: quote.jobTicketId,
            branchId: quote.branchId,
            estimatedMinutes: quote.estimatedMinutes,
            items: quote.items.map((i) => ({
              kind: i.kind,
              nameEn: i.nameEn,
              nameAr: i.nameAr,
            })),
          },
        },
      );

      const partReservation =
        await this.inventory.reserveFromApprovedQuotationInTx(tx, {
          organizationId,
          branchId: quote.branchId,
          actorId,
          workOrderId: workOrder.id,
          visitId: quote.visitId,
          items: quote.items.map((i) => ({
            partId: i.partId,
            qty: Number(i.qty),
            kind: i.kind,
          })),
        });

      if (partReservation.unavailable.length) {
        await this.events.emit(
          'inventory.parts_unavailable',
          {
            organizationId,
            branchId: quote.branchId,
            quotationId: id,
            workOrderId: workOrder.id,
            unavailable: partReservation.unavailable,
            deferredPurchase: partReservation.deferred_purchase,
          },
          tx,
        );
      }

      await this.events.emit(
        'quotation.approved',
        {
          organizationId,
          branchId: quote.branchId,
          quotationId: id,
          visitId: quote.visitId,
          number: quote.number,
          version: quote.version,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number,
          partReservation,
        },
        tx,
      );

      return {
        quote: await tx.quotation.findFirstOrThrow({
          where: { id },
          include: this.include(),
        }),
        workOrderId: workOrder.id,
        partReservation,
      };
    });

    const result = this.toDto(updated.quote);
    const workOrder = await this.workOrders.getById(
      organizationId,
      updated.workOrderId,
    );
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.approve',
      entity: 'Quotation',
      entityId: id,
      after: {
        ...result,
        workOrderId: workOrder.id,
        partReservation: updated.partReservation,
      },
    });
    return {
      ...result,
      visitStatus: 'readyForRepair' as const,
      workOrder,
      hooks: {
        partReservation: updated.partReservation,
      },
    };
  }

  async reject(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { comment?: string; actorType?: ApprovalActorType },
  ) {
    return this.decideNegative(
      organizationId,
      actorId,
      id,
      'reject',
      'quotation.rejected',
      dto,
    );
  }

  async requestChanges(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { comment?: string; actorType?: ApprovalActorType },
  ) {
    const quote = await this.findOrFail(organizationId, id);
    this.assertPendingNotExpired(quote);

    const actorType = dto?.actorType ?? 'staff';
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.quotation.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'draft',
          decidedAt: new Date(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quotation was modified by another request',
        });
      }

      await tx.quotationApproval.create({
        data: {
          quotationId: id,
          actorType,
          actorId,
          decision: 'request_changes',
          comment: dto?.comment,
        },
      });

      // OQ-02: visit stays waitingApproval
      await this.events.emit(
        'quotation.changes_requested',
        {
          quotationId: id,
          visitId: quote.visitId,
          number: quote.number,
          version: quote.version,
          comment: dto?.comment ?? null,
        },
        tx,
      );

      return tx.quotation.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.request_changes',
      entity: 'Quotation',
      entityId: id,
      after: result,
    });
    return {
      ...result,
      visitStatus: 'waitingApproval' as const,
    };
  }

  async newVersion(organizationId: string, actorId: string, id: string) {
    const quote = await this.findOrFail(organizationId, id);
    if (!['pending', 'rejected', 'sent', 'expired'].includes(quote.status)) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: `Cannot create new version from status ${quote.status}`,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id },
        data: { status: 'superseded' },
      });

      return tx.quotation.create({
        data: {
          organizationId,
          branchId: quote.branchId,
          visitId: quote.visitId,
          jobTicketId: quote.jobTicketId,
          customerId: quote.customerId,
          vehicleId: quote.vehicleId,
          number: quote.number,
          version: quote.version + 1,
          parentQuotationId: quote.id,
          status: 'draft',
          subtotal: quote.subtotal,
          discount: quote.discount,
          tax: quote.tax,
          total: quote.total,
          estimatedMinutes: quote.estimatedMinutes,
          createdBy: actorId,
          items: {
            create: quote.items.map((item) => ({
              kind: item.kind,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              qty: item.qty,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              partId: item.partId,
              serviceId: item.serviceId,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: this.include(),
      });
    });

    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.new_version',
      entity: 'Quotation',
      entityId: created.id,
      after: result,
      metadata: { supersededId: id },
    });
    return result;
  }

  /** Nightly / scheduled expiry — marks overdue pending quotes as expired */
  async expireOverdue(organizationId?: string) {
    const where: Prisma.QuotationWhereInput = {
      status: 'pending',
      validUntil: { lt: new Date() },
      ...(organizationId ? { organizationId } : {}),
    };
    const overdue = await this.prisma.quotation.findMany({
      where,
      select: { id: true, organizationId: true, branchId: true, number: true },
      take: 500,
    });
    if (!overdue.length) return { expired: 0 };

    const result = await this.prisma.quotation.updateMany({
      where: { id: { in: overdue.map((q) => q.id) }, status: 'pending' },
      data: { status: 'expired' },
    });

    // Group by org for notification fan-out
    const byOrg = new Map<string, typeof overdue>();
    for (const q of overdue) {
      const list = byOrg.get(q.organizationId) ?? [];
      list.push(q);
      byOrg.set(q.organizationId, list);
    }
    for (const [orgId, list] of byOrg) {
      await this.events.emit('quotation.expired', {
        organizationId: orgId,
        branchId: list[0]?.branchId,
        expired: list.length,
        quotationIds: list.map((q) => q.id),
      });
    }

    return { expired: result.count };
  }

  private async decideNegative(
    organizationId: string,
    actorId: string,
    id: string,
    decision: Extract<ApprovalDecision, 'reject'>,
    eventType: string,
    dto?: { comment?: string; actorType?: ApprovalActorType },
  ) {
    const quote = await this.findOrFail(organizationId, id);
    this.assertPendingNotExpired(quote);

    const actorType = dto?.actorType ?? 'staff';
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.quotation.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'rejected',
          decidedAt: new Date(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quotation was modified by another request',
        });
      }

      await tx.quotationApproval.create({
        data: {
          quotationId: id,
          actorType,
          actorId,
          decision,
          comment: dto?.comment,
        },
      });

      // OQ-02: visit remains waitingApproval
      await this.events.emit(
        eventType,
        {
          quotationId: id,
          visitId: quote.visitId,
          number: quote.number,
          version: quote.version,
          comment: dto?.comment ?? null,
        },
        tx,
      );

      return tx.quotation.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: quote.branchId,
      actorId,
      action: 'quotation.reject',
      entity: 'Quotation',
      entityId: id,
      after: result,
    });
    return {
      ...result,
      visitStatus: 'waitingApproval' as const,
    };
  }

  private assertPendingNotExpired(quote: {
    status: QuotationStatus;
    validUntil: Date | null;
  }) {
    if (quote.status !== 'pending') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Quotation must be pending (current: ${quote.status})`,
      });
    }
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
      throw new ConflictException({
        code: ErrorCodes.QUOTE_EXPIRED,
        message: 'Quotation has expired',
        details: { validUntil: quote.validUntil },
      });
    }
  }

  private async getTaxRate(organizationId: string): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key: 'default_tax_rate',
        },
      },
    });
    const rate = Number(setting?.value ?? 14);
    return Number.isFinite(rate) ? rate : 14;
  }

  private async findOrFail(organizationId: string, id: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!quote) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quotation not found',
      });
    }
    return quote;
  }

  private include() {
    return {
      items: { orderBy: { sortOrder: 'asc' as const } },
      approvals: { orderBy: { createdAt: 'desc' as const } },
      customer: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          phone: true,
        },
      },
      visit: {
        select: {
          id: true,
          status: true,
          version: true,
          branchId: true,
        },
      },
    } satisfies Prisma.QuotationInclude;
  }

  private toDto(
    quote: Prisma.QuotationGetPayload<{
      include: ReturnType<QuotationsService['include']>;
    }>,
  ) {
    return {
      id: quote.id,
      number: quote.number,
      version: quote.version,
      status: quote.status,
      visitId: quote.visitId,
      visitStatus: quote.visit.status,
      jobTicketId: quote.jobTicketId,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      branchId: quote.branchId,
      parentQuotationId: quote.parentQuotationId,
      customer: quote.customer.nameEn,
      customerAr: quote.customer.nameAr,
      customerNameEn: quote.customer.nameEn,
      customerNameAr: quote.customer.nameAr,
      phone: quote.customer.phone,
      subtotal: Number(quote.subtotal),
      discount: Number(quote.discount),
      tax: Number(quote.tax),
      total: Number(quote.total),
      estimatedMinutes: quote.estimatedMinutes,
      validUntil: quote.validUntil,
      sentAt: quote.sentAt,
      decidedAt: quote.decidedAt,
      items: quote.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        partId: i.partId,
        serviceId: i.serviceId,
        sortOrder: i.sortOrder,
      })),
      approvals: quote.approvals.map((a) => ({
        id: a.id,
        actorType: a.actorType,
        actorId: a.actorId,
        decision: a.decision,
        comment: a.comment,
        createdAt: a.createdAt,
      })),
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }
}
