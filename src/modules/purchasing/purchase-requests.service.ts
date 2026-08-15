import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';

const PR_TRANSITIONS: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: PurchaseRequestStatus;
      quotationId?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.PurchaseRequestWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.quotationId ? { quotationId: query.quotationId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.include(),
      }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    return this.toDto(await this.findOrFail(organizationId, id));
  }

  async create(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      reason?: string;
      quotationId?: string;
      visitId?: string;
      workOrderId?: string;
      items: Array<{ partId: string; qty: number; notes?: string }>;
    },
  ) {
    this.assertItems(dto.items);
    await this.assertParts(
      organizationId,
      dto.items.map((i) => i.partId),
    );

    if (dto.quotationId) {
      const existing = await this.findOpenForQuotation(
        organizationId,
        dto.quotationId,
      );
      if (existing) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'An open purchase request already exists for this quotation',
          details: { purchaseRequestId: existing.id, number: existing.number },
        });
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'PR');
      return tx.purchaseRequest.create({
        data: {
          organizationId,
          branchId,
          number,
          requestedBy: actorId,
          reason: dto.reason,
          quotationId: dto.quotationId,
          visitId: dto.visitId,
          workOrderId: dto.workOrderId,
          status: 'draft',
          items: {
            create: dto.items.map((i) => ({
              partId: i.partId,
              qty: i.qty,
              notes: i.notes,
            })),
          },
        },
        include: this.include(),
      });
    });

    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'purchase_request.create',
      entity: 'PurchaseRequest',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  /**
   * Fulfil Phase 11 unavailable-parts hook — create (or reuse) a PR from
   * quotation approve deferred_purchase lines.
   */
  async createFromUnavailable(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      quotationId: string;
      visitId?: string;
      workOrderId?: string;
      reason?: string;
      items: Array<{ partId: string; qty: number; notes?: string }>;
      autoSubmit?: boolean;
    },
  ) {
    this.assertItems(dto.items);
    await this.assertParts(
      organizationId,
      dto.items.map((i) => i.partId),
    );

    const existing = await this.findOpenForQuotation(
      organizationId,
      dto.quotationId,
    );
    if (existing) {
      return this.toDto(existing);
    }

    const quote = await this.prisma.quotation.findFirst({
      where: { id: dto.quotationId, organizationId, branchId },
    });
    if (!quote) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quotation not found in branch',
      });
    }

    let created = await this.create(organizationId, branchId, actorId, {
      reason:
        dto.reason ??
        `Unavailable parts for quotation ${quote.number} (deferred procurement)`,
      quotationId: dto.quotationId,
      visitId: dto.visitId,
      workOrderId: dto.workOrderId,
      items: dto.items,
    });

    if (dto.autoSubmit !== false) {
      created = await this.submit(organizationId, actorId, created.id);
    }
    return created;
  }

  async submit(organizationId: string, actorId: string, id: string) {
    return this.transition(organizationId, actorId, id, 'pending_approval', {
      action: 'purchase_request.submit',
      event: 'purchase.request.submitted',
    });
  }

  async approve(organizationId: string, actorId: string, id: string) {
    return this.transition(organizationId, actorId, id, 'approved', {
      action: 'purchase_request.approve',
      event: 'purchase.request.approved',
      from: 'pending_approval',
    });
  }

  async reject(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    return this.transition(organizationId, actorId, id, 'cancelled', {
      action: 'purchase_request.reject',
      event: 'purchase.request.rejected',
      from: 'pending_approval',
      reason: dto?.reason,
    });
  }

  async cancel(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    return this.transition(organizationId, actorId, id, 'cancelled', {
      action: 'purchase_request.cancel',
      event: 'purchase.request.cancelled',
      reason: dto?.reason,
    });
  }

  private async transition(
    organizationId: string,
    actorId: string,
    id: string,
    to: PurchaseRequestStatus,
    opts: {
      action: string;
      event: string;
      from?: PurchaseRequestStatus;
      reason?: string;
    },
  ) {
    const existing = await this.findOrFail(organizationId, id);
    if (opts.from && existing.status !== opts.from) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Expected status ${opts.from}, got ${existing.status}`,
      });
    }
    this.assertTransition(existing.status, to);

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.purchaseRequest.updateMany({
        where: {
          id,
          organizationId,
          status: existing.status,
        },
        data: {
          status: to,
          ...(opts.reason
            ? {
                reason: existing.reason
                  ? `${existing.reason}\n${opts.reason}`
                  : opts.reason,
              }
            : {}),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Purchase request was modified by another request',
        });
      }
      await this.events.emit(
        opts.event,
        {
          purchaseRequestId: id,
          number: existing.number,
          from: existing.status,
          to,
        },
        tx,
      );
      return tx.purchaseRequest.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: existing.branchId,
      actorId,
      action: opts.action,
      entity: 'PurchaseRequest',
      entityId: id,
      before: { status: existing.status },
      after: result,
    });
    return result;
  }

  async markOrderedInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ) {
    const row = await tx.purchaseRequest.findFirst({
      where: { id, organizationId },
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Purchase request not found',
      });
    }
    if (row.status !== 'approved' && row.status !== 'ordered') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot convert PR in status ${row.status}`,
      });
    }
    if (row.status === 'approved') {
      await tx.purchaseRequest.update({
        where: { id },
        data: { status: 'ordered' },
      });
    }
    return row;
  }

  async markReceivedInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ) {
    await tx.purchaseRequest.updateMany({
      where: {
        id,
        organizationId,
        status: { in: ['ordered', 'approved'] },
      },
      data: { status: 'received' },
    });
  }

  private assertTransition(
    from: PurchaseRequestStatus,
    to: PurchaseRequestStatus,
  ) {
    if (!PR_TRANSITIONS[from]?.includes(to)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot transition purchase request ${from} → ${to}`,
      });
    }
  }

  private assertItems(items: Array<{ partId: string; qty: number }>) {
    if (!items?.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one line item is required',
      });
    }
    for (const i of items) {
      if (!(Number(i.qty) > 0)) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Item quantity must be > 0',
        });
      }
    }
  }

  private async assertParts(organizationId: string, partIds: string[]) {
    const unique = [...new Set(partIds)];
    const count = await this.prisma.part.count({
      where: { organizationId, id: { in: unique }, isActive: true },
    });
    if (count !== unique.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more parts are invalid',
      });
    }
  }

  private async findOpenForQuotation(
    organizationId: string,
    quotationId: string,
  ) {
    return this.prisma.purchaseRequest.findFirst({
      where: {
        organizationId,
        quotationId,
        status: {
          notIn: ['cancelled', 'received'],
        },
      },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.purchaseRequest.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Purchase request not found',
      });
    }
    return row;
  }

  private include() {
    return {
      items: true,
      purchaseOrders: {
        select: { id: true, number: true, status: true },
      },
    } as const;
  }

  toDto(
    row: Prisma.PurchaseRequestGetPayload<{
      include: ReturnType<PurchaseRequestsService['include']>;
    }>,
  ) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      number: row.number,
      status: row.status,
      reason: row.reason,
      quotationId: row.quotationId,
      visitId: row.visitId,
      workOrderId: row.workOrderId,
      requestedBy: row.requestedBy,
      items: row.items.map((i) => ({
        id: i.id,
        partId: i.partId,
        qty: Number(i.qty),
        notes: i.notes,
      })),
      purchaseOrders: row.purchaseOrders,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
