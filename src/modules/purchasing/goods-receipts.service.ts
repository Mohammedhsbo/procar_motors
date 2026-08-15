import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { PurchaseRequestsService } from './purchase-requests.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly purchaseRequests: PurchaseRequestsService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; poId?: string; status?: string },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.GoodsReceiptWhereInput = {
      organizationId,
      branchId,
      ...(query.poId ? { poId: query.poId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.goodsReceipt.count({ where }),
      this.prisma.goodsReceipt.findMany({
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
      poId: string;
      warehouseId?: string;
      supplierInvoiceRef?: string;
      notes?: string;
      items: Array<{
        poItemId: string;
        qtyReceived: number;
        qtyRejected?: number;
        unitCostActual?: number;
      }>;
    },
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.poId, organizationId, branchId },
      include: { items: true },
    });
    if (!po) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Purchase order not found',
      });
    }
    if (!['approved', 'partially_received'].includes(po.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot receive against PO in status ${po.status}`,
      });
    }
    if (!dto.items?.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one receipt line is required',
      });
    }

    const warehouse = await this.resolveWarehouse(
      this.prisma,
      branchId,
      dto.warehouseId,
    );

    const poItemById = new Map(po.items.map((i) => [i.id, i]));
    for (const line of dto.items) {
      const poItem = poItemById.get(line.poItemId);
      if (!poItem) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'poItemId does not belong to this PO',
          details: { poItemId: line.poItemId },
        });
      }
      const remaining = Number(poItem.qtyOrdered) - Number(poItem.qtyReceived);
      const qty = Number(line.qtyReceived);
      const rejected = Number(line.qtyRejected ?? 0);
      if (!(qty > 0) || rejected < 0) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid receipt quantities',
        });
      }
      if (qty > remaining + 1e-9) {
        throw new ConflictException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Receipt qty exceeds remaining ordered qty',
          details: {
            poItemId: line.poItemId,
            remaining,
            qtyReceived: qty,
          },
        });
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'GRN');
      return tx.goodsReceipt.create({
        data: {
          organizationId,
          branchId,
          poId: po.id,
          warehouseId: warehouse.id,
          number,
          status: 'draft',
          supplierInvoiceRef: dto.supplierInvoiceRef,
          notes: dto.notes,
          items: {
            create: dto.items.map((i) => ({
              poItemId: i.poItemId,
              qtyReceived: i.qtyReceived,
              qtyRejected: i.qtyRejected ?? 0,
              unitCostActual: i.unitCostActual,
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
      action: 'goods_receipt.create',
      entity: 'GoodsReceipt',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  async receive(organizationId: string, actorId: string, id: string) {
    const existing = await this.findOrFail(organizationId, id);
    if (existing.status === 'received') {
      return this.toDto(existing);
    }
    if (existing.status !== 'draft') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot receive GRN in status ${existing.status}`,
      });
    }

    const po = existing.purchaseOrder;
    if (!['approved', 'partially_received'].includes(po.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot receive against PO in status ${po.status}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-lock PO items and validate remaining under concurrency
      const freshPo = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: po.id },
        include: { items: true },
      });
      const poItemById = new Map(freshPo.items.map((i) => [i.id, i]));

      for (const line of existing.items) {
        const poItem = poItemById.get(line.poItemId);
        if (!poItem) {
          throw new ConflictException({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'PO item missing during receive',
          });
        }
        const remaining =
          Number(poItem.qtyOrdered) - Number(poItem.qtyReceived);
        const qty = Number(line.qtyReceived);
        if (qty > remaining + 1e-9) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Concurrent receive exceeded remaining quantity',
            details: { poItemId: line.poItemId, remaining, qty },
          });
        }

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { qtyReceived: Number(poItem.qtyReceived) + qty },
        });

        const unitCost =
          line.unitCostActual != null
            ? Number(line.unitCostActual)
            : Number(poItem.unitPrice);

        await this.stock.applyMutation(tx, {
          organizationId,
          branchId: existing.branchId,
          warehouseId: existing.warehouseId,
          partId: poItem.partId,
          deltaOnHand: qty,
          deltaReserved: 0,
          type: 'purchase_in',
          writeLedger: true,
          unitCost,
          actorId,
          referenceType: 'goods_receipt',
          referenceId: id,
          notes: existing.supplierInvoiceRef
            ? `Supplier invoice: ${existing.supplierInvoiceRef}`
            : `GRN ${existing.number}`,
        });

        const part = await tx.part.findFirst({
          where: { id: poItem.partId },
          select: { minStock: true },
        });
        const bal = await this.stock.lockBalance(
          tx,
          existing.warehouseId,
          poItem.partId,
        );
        await this.stock.refreshAlert(tx, {
          branchId: existing.branchId,
          warehouseId: existing.warehouseId,
          partId: poItem.partId,
          onHand: Number(bal.onHand),
          reserved: Number(bal.reserved),
          minStock: Number(part?.minStock ?? 0),
        });
      }

      const moved = await tx.goodsReceipt.updateMany({
        where: { id, status: 'draft' },
        data: {
          status: 'received',
          receivedBy: actorId,
          receivedAt: new Date(),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Goods receipt was already processed',
        });
      }

      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { poId: po.id },
      });
      const allReceived = refreshedItems.every(
        (i) => Number(i.qtyReceived) + 1e-9 >= Number(i.qtyOrdered),
      );
      const anyReceived = refreshedItems.some((i) => Number(i.qtyReceived) > 0);
      const nextPoStatus = allReceived
        ? 'received'
        : anyReceived
          ? 'partially_received'
          : freshPo.status;

      if (nextPoStatus !== freshPo.status) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: nextPoStatus },
        });
      }

      if (allReceived && freshPo.purchaseRequestId) {
        await this.purchaseRequests.markReceivedInTx(
          tx,
          organizationId,
          freshPo.purchaseRequestId,
        );
      }

      await this.events.emit(
        'purchase.goods.received',
        {
          goodsReceiptId: id,
          number: existing.number,
          purchaseOrderId: po.id,
          warehouseId: existing.warehouseId,
          supplierInvoiceRef: existing.supplierInvoiceRef,
          fullyReceived: allReceived,
        },
        tx,
      );

      return tx.goodsReceipt.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: existing.branchId,
      actorId,
      action: 'goods_receipt.receive',
      entity: 'GoodsReceipt',
      entityId: id,
      after: result,
    });
    return result;
  }

  private async resolveWarehouse(
    db: PrismaService | Tx,
    branchId: string,
    warehouseId?: string,
  ) {
    if (warehouseId) {
      const wh = await db.warehouse.findFirst({
        where: { id: warehouseId, branchId },
      });
      if (!wh) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Warehouse not found in branch',
        });
      }
      return wh;
    }
    const def = await db.warehouse.findFirst({
      where: { branchId, isDefault: true },
    });
    if (!def) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Default warehouse not found',
      });
    }
    return def;
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.goodsReceipt.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Goods receipt not found',
      });
    }
    return row;
  }

  private include() {
    return {
      items: true,
      purchaseOrder: {
        include: { items: true },
      },
    } as const;
  }

  toDto(
    row: Prisma.GoodsReceiptGetPayload<{
      include: ReturnType<GoodsReceiptsService['include']>;
    }>,
  ) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      warehouseId: row.warehouseId,
      poId: row.poId,
      purchaseOrderNumber: row.purchaseOrder.number,
      purchaseOrderStatus: row.purchaseOrder.status,
      number: row.number,
      status: row.status,
      supplierInvoiceRef: row.supplierInvoiceRef,
      notes: row.notes,
      receivedBy: row.receivedBy,
      receivedAt: row.receivedAt,
      items: row.items.map((i) => ({
        id: i.id,
        poItemId: i.poItemId,
        qtyReceived: Number(i.qtyReceived),
        qtyRejected: Number(i.qtyRejected),
        unitCostActual:
          i.unitCostActual != null ? Number(i.unitCostActual) : null,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
