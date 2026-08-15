import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { PurchaseRequestsService } from './purchase-requests.service';
import { computePoTotals } from './po-totals';

const PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  new: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
    private readonly suppliers: SuppliersService,
    private readonly purchaseRequests: PurchaseRequestsService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: PurchaseOrderStatus;
      supplierId?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
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
      supplierId: string;
      purchaseRequestId?: string;
      discount?: number;
      notes?: string;
      taxRate?: number;
      items?: Array<{
        partId: string;
        qtyOrdered: number;
        unitPrice: number;
        taxRate?: number;
      }>;
      autoSubmit?: boolean;
    },
  ) {
    await this.suppliers.assertActive(organizationId, dto.supplierId);

    let items = dto.items ?? [];
    const purchaseRequestId = dto.purchaseRequestId;

    if (purchaseRequestId) {
      const pr = await this.prisma.purchaseRequest.findFirst({
        where: { id: purchaseRequestId, organizationId, branchId },
        include: { items: true, purchaseOrders: true },
      });
      if (!pr) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Purchase request not found',
        });
      }
      if (pr.status !== 'approved' && pr.status !== 'ordered') {
        throw new ConflictException({
          code: ErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Purchase request must be approved (got ${pr.status})`,
        });
      }
      const openPo = pr.purchaseOrders.find((p) => p.status !== 'cancelled');
      if (openPo) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'A purchase order already exists for this request',
          details: { purchaseOrderId: openPo.id, number: openPo.number },
        });
      }

      if (!items.length) {
        const parts = await this.prisma.part.findMany({
          where: {
            organizationId,
            id: { in: pr.items.map((i) => i.partId) },
          },
        });
        const costById = new Map(parts.map((p) => [p.id, Number(p.costPrice)]));
        const defaultTax = dto.taxRate ?? 14;
        items = pr.items.map((i) => ({
          partId: i.partId,
          qtyOrdered: Number(i.qty),
          unitPrice: costById.get(i.partId) ?? 0,
          taxRate: defaultTax,
        }));
      }
    }

    if (!items.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one PO line item is required',
      });
    }

    for (const i of items) {
      if (!(Number(i.qtyOrdered) > 0) || Number(i.unitPrice) < 0) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid qtyOrdered/unitPrice',
        });
      }
    }

    const partIds = [...new Set(items.map((i) => i.partId))];
    const partCount = await this.prisma.part.count({
      where: { organizationId, id: { in: partIds }, isActive: true },
    });
    if (partCount !== partIds.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more parts are invalid',
      });
    }

    const defaultTax = dto.taxRate ?? 14;
    const normalized = items.map((i) => ({
      partId: i.partId,
      qtyOrdered: Number(i.qtyOrdered),
      unitPrice: Number(i.unitPrice),
      taxRate: i.taxRate ?? defaultTax,
    }));
    const totals = computePoTotals(normalized, dto.discount ?? 0);

    const created = await this.prisma.$transaction(async (tx) => {
      if (purchaseRequestId) {
        await this.purchaseRequests.markOrderedInTx(
          tx,
          organizationId,
          purchaseRequestId,
        );
      }
      const number = await this.sequences.nextInTx(tx, organizationId, 'PO');
      return tx.purchaseOrder.create({
        data: {
          organizationId,
          branchId,
          supplierId: dto.supplierId,
          purchaseRequestId,
          number,
          status: 'new',
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
          notes: dto.notes,
          createdBy: actorId,
          items: {
            create: normalized.map((i) => ({
              partId: i.partId,
              qtyOrdered: i.qtyOrdered,
              unitPrice: i.unitPrice,
              taxRate: i.taxRate,
            })),
          },
        },
        include: this.include(),
      });
    });

    let result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'purchase_order.create',
      entity: 'PurchaseOrder',
      entityId: created.id,
      after: result,
    });

    if (dto.autoSubmit) {
      result = await this.submit(organizationId, actorId, created.id);
    }
    return result;
  }

  async submit(organizationId: string, actorId: string, id: string) {
    return this.transition(organizationId, actorId, id, 'pending_approval', {
      action: 'purchase_order.submit',
      event: 'purchase.order.submitted',
      from: 'new',
    });
  }

  async approve(organizationId: string, actorId: string, id: string) {
    // Locked: submit is mandatory — approve only from pending_approval
    return this.transition(organizationId, actorId, id, 'approved', {
      action: 'purchase_order.approve',
      event: 'purchase.order.approved',
      from: 'pending_approval',
    });
  }

  async cancel(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    const existing = await this.findOrFail(organizationId, id);
    if (['partially_received', 'received'].includes(existing.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Cannot cancel a PO that has already received goods',
      });
    }
    return this.transition(organizationId, actorId, id, 'cancelled', {
      action: 'purchase_order.cancel',
      event: 'purchase.order.cancelled',
      reason: dto?.reason,
    });
  }

  private async transition(
    organizationId: string,
    actorId: string,
    id: string,
    to: PurchaseOrderStatus,
    opts: {
      action: string;
      event: string;
      from?: PurchaseOrderStatus;
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
    if (!PO_TRANSITIONS[existing.status]?.includes(to)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot transition purchase order ${existing.status} → ${to}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.purchaseOrder.updateMany({
        where: { id, organizationId, status: existing.status },
        data: {
          status: to,
          ...(opts.reason
            ? {
                notes: existing.notes
                  ? `${existing.notes}\n${opts.reason}`
                  : opts.reason,
              }
            : {}),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Purchase order was modified by another request',
        });
      }
      await this.events.emit(
        opts.event,
        {
          purchaseOrderId: id,
          number: existing.number,
          from: existing.status,
          to,
          organizationId,
          branchId: existing.branchId,
          supplierId: existing.supplierId,
        },
        tx,
      );
      return tx.purchaseOrder.findFirstOrThrow({
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
      entity: 'PurchaseOrder',
      entityId: id,
      before: { status: existing.status },
      after: result,
    });
    return result;
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Purchase order not found',
      });
    }
    return row;
  }

  include() {
    return {
      items: true,
      supplier: true,
      purchaseRequest: {
        select: { id: true, number: true, status: true },
      },
      goodsReceipts: {
        select: { id: true, number: true, status: true },
      },
    } as const;
  }

  toDto(
    row: Prisma.PurchaseOrderGetPayload<{
      include: ReturnType<PurchaseOrdersService['include']>;
    }>,
  ) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      number: row.number,
      status: row.status,
      supplierId: row.supplierId,
      supplier: {
        id: row.supplier.id,
        nameEn: row.supplier.nameEn,
        nameAr: row.supplier.nameAr,
        status: row.supplier.status,
      },
      purchaseRequestId: row.purchaseRequestId,
      purchaseRequest: row.purchaseRequest,
      subtotal: Number(row.subtotal),
      tax: Number(row.tax),
      discount: Number(row.discount),
      total: Number(row.total),
      notes: row.notes,
      items: row.items.map((i) => ({
        id: i.id,
        partId: i.partId,
        qtyOrdered: Number(i.qtyOrdered),
        qtyReceived: Number(i.qtyReceived),
        qtyRemaining: Math.max(0, Number(i.qtyOrdered) - Number(i.qtyReceived)),
        unitPrice: Number(i.unitPrice),
        taxRate: Number(i.taxRate),
      })),
      goodsReceipts: row.goodsReceipts,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
