import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from './stock.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: string;
      workOrderId?: string;
      partId?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const warehouseIds = (
      await this.prisma.warehouse.findMany({
        where: { branchId },
        select: { id: true },
      })
    ).map((w) => w.id);

    const where: Prisma.StockReservationWhereInput = {
      warehouseId: { in: warehouseIds },
      workOrder: { organizationId },
      ...(query.status
        ? {
            status:
              query.status as Prisma.EnumReservationStatusFilter['equals'],
          }
        : {}),
      ...(query.workOrderId ? { workOrderId: query.workOrderId } : {}),
      ...(query.partId ? { partId: query.partId } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.stockReservation.count({ where }),
      this.prisma.stockReservation.findMany({
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
    const row = await this.findOrFail(organizationId, id);
    return this.toDto(row);
  }

  async reserve(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      qty: number;
      workOrderId: string;
      warehouseId?: string;
      visitId?: string;
    },
  ) {
    if (!(dto.qty > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'qty must be greater than 0',
      });
    }

    const result = await this.prisma.$transaction(async (tx) =>
      this.reserveInTx(tx, organizationId, branchId, actorId, dto),
    );

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'inventory.reservation.create',
      entity: 'StockReservation',
      entityId: result.id,
      after: result,
    });
    return result;
  }

  async reserveInTx(
    tx: Tx,
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      qty: number;
      workOrderId: string;
      warehouseId?: string;
      visitId?: string;
    },
  ) {
    const wo = await tx.workOrder.findFirst({
      where: { id: dto.workOrderId, organizationId },
    });
    if (!wo) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Work order not found',
      });
    }
    if (wo.branchId !== branchId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Work order is not in the active branch',
      });
    }

    const part = await tx.part.findFirst({
      where: { id: dto.partId, organizationId, deletedAt: null },
    });
    if (!part) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Part not found',
      });
    }

    const warehouse = await this.resolveWarehouse(
      tx,
      branchId,
      dto.warehouseId,
    );

    const mutated = await this.stock.applyMutation(tx, {
      organizationId,
      branchId,
      warehouseId: warehouse.id,
      partId: part.id,
      deltaOnHand: 0,
      deltaReserved: dto.qty,
      type: 'issue', // type unused for ledger when writeLedger false
      writeLedger: false,
      requireAvailable: dto.qty,
      actorId,
      referenceType: 'work_order',
      referenceId: wo.id,
    });

    const reservation = await tx.stockReservation.create({
      data: {
        warehouseId: warehouse.id,
        partId: part.id,
        workOrderId: wo.id,
        visitId: dto.visitId ?? wo.visitId,
        qty: dto.qty,
        qtyConsumed: 0,
        status: 'active',
        createdBy: actorId,
      },
      include: this.include(),
    });

    await this.stock.refreshAlert(tx, {
      branchId,
      warehouseId: warehouse.id,
      partId: part.id,
      onHand: mutated.onHand,
      reserved: mutated.reserved,
      minStock: part.minStock,
    });

    return this.toDto(reservation);
  }

  async release(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    return this.closeReservation(
      organizationId,
      actorId,
      id,
      'released',
      dto?.reason,
    );
  }

  async cancel(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    return this.closeReservation(
      organizationId,
      actorId,
      id,
      'cancelled',
      dto?.reason,
    );
  }

  async consume(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { qty?: number },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM inventory.stock_reservations
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      const existing = await tx.stockReservation.findFirst({
        where: { id, workOrder: { organizationId } },
        include: this.include(),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Reservation not found',
        });
      }
      if (existing.status !== 'active') {
        throw new ConflictException({
          code: ErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot consume reservation in status ${existing.status}`,
        });
      }

      const remaining = Number(existing.qty) - Number(existing.qtyConsumed);
      const qty = dto?.qty ?? remaining;
      if (!(qty > 0) || qty > remaining + 1e-9) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid consume quantity',
          details: { qty, remaining },
        });
      }

      const mutated = await this.stock.applyMutation(tx, {
        organizationId,
        branchId: existing.workOrder.branchId,
        warehouseId: existing.warehouseId,
        partId: existing.partId,
        deltaOnHand: -qty,
        deltaReserved: -qty,
        type: 'consume',
        writeLedger: true,
        actorId,
        unitCost: Number(existing.part.costPrice),
        referenceType: 'stock_reservation',
        referenceId: id,
      });

      const newConsumed = Number(existing.qtyConsumed) + qty;
      const fully = newConsumed + 1e-9 >= Number(existing.qty);
      const updated = await tx.stockReservation.update({
        where: { id },
        data: {
          qtyConsumed: newConsumed,
          status: fully ? 'consumed' : 'active',
        },
        include: this.include(),
      });

      await this.stock.refreshAlert(tx, {
        branchId: existing.workOrder.branchId,
        warehouseId: existing.warehouseId,
        partId: existing.partId,
        onHand: mutated.onHand,
        reserved: mutated.reserved,
        minStock: existing.part.minStock,
      });

      return {
        dto: this.toDto(updated),
        branchId: existing.workOrder.branchId,
      };
    });

    await this.audit.log({
      organizationId,
      branchId: result.branchId,
      actorId,
      action: 'inventory.reservation.consume',
      entity: 'StockReservation',
      entityId: id,
      after: result.dto,
    });
    return result.dto;
  }

  /** Return previously consumed parts to stock (unused issue return) */
  async returnToStock(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      qty: number;
      workOrderId: string;
      warehouseId?: string;
      notes?: string;
    },
  ) {
    if (!(dto.qty > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'qty must be greater than 0',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: dto.workOrderId, organizationId, branchId },
      });
      if (!wo) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Work order not found',
        });
      }
      const part = await tx.part.findFirst({
        where: { id: dto.partId, organizationId, deletedAt: null },
      });
      if (!part) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Part not found',
        });
      }
      const warehouse = await this.resolveWarehouse(
        tx,
        branchId,
        dto.warehouseId,
      );

      const mutated = await this.stock.applyMutation(tx, {
        organizationId,
        branchId,
        warehouseId: warehouse.id,
        partId: part.id,
        deltaOnHand: dto.qty,
        deltaReserved: 0,
        type: 'return',
        writeLedger: true,
        actorId,
        unitCost: Number(part.costPrice),
        referenceType: 'work_order',
        referenceId: wo.id,
        notes: dto.notes ?? 'Return from work order',
      });

      await this.stock.refreshAlert(tx, {
        branchId,
        warehouseId: warehouse.id,
        partId: part.id,
        onHand: mutated.onHand,
        reserved: mutated.reserved,
        minStock: part.minStock,
      });

      return {
        partId: part.id,
        workOrderId: wo.id,
        warehouseId: warehouse.id,
        qty: dto.qty,
        onHand: mutated.onHand,
        reserved: mutated.reserved,
        available: mutated.available,
        transactionId: mutated.transactionId,
      };
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'inventory.return',
      entity: 'InventoryTransaction',
      entityId: result.transactionId ?? undefined,
      after: result,
    });
    return result;
  }

  private async closeReservation(
    organizationId: string,
    actorId: string,
    id: string,
    toStatus: 'released' | 'cancelled',
    reason?: string,
  ) {
    const existing = await this.findOrFail(organizationId, id);
    if (existing.status !== 'active') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot ${toStatus.slice(0, -1)} reservation in status ${existing.status}`,
      });
    }

    const remaining = Number(existing.qty) - Number(existing.qtyConsumed);
    const result = await this.prisma.$transaction(async (tx) => {
      if (remaining > 0) {
        const mutated = await this.stock.applyMutation(tx, {
          organizationId,
          branchId: existing.workOrder.branchId,
          warehouseId: existing.warehouseId,
          partId: existing.partId,
          deltaOnHand: 0,
          deltaReserved: -remaining,
          type: 'issue',
          writeLedger: false,
          actorId,
          referenceType: 'stock_reservation',
          referenceId: id,
          notes: reason ?? null,
        });
        await this.stock.refreshAlert(tx, {
          branchId: existing.workOrder.branchId,
          warehouseId: existing.warehouseId,
          partId: existing.partId,
          onHand: mutated.onHand,
          reserved: mutated.reserved,
          minStock: existing.part.minStock,
        });
      }

      const updated = await tx.stockReservation.update({
        where: { id },
        data: { status: toStatus },
        include: this.include(),
      });
      return this.toDto(updated);
    });

    await this.audit.log({
      organizationId,
      branchId: existing.workOrder.branchId,
      actorId,
      action:
        toStatus === 'released'
          ? 'inventory.reservation.release'
          : 'inventory.reservation.cancel',
      entity: 'StockReservation',
      entityId: id,
      after: result,
    });
    return result;
  }

  private async resolveWarehouse(
    tx: Tx,
    branchId: string,
    warehouseId?: string,
  ) {
    if (warehouseId) {
      const wh = await tx.warehouse.findFirst({
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
    const def = await tx.warehouse.findFirst({
      where: { branchId, isDefault: true },
    });
    if (!def) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Default warehouse not found for branch',
      });
    }
    return def;
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.stockReservation.findFirst({
      where: { id, workOrder: { organizationId } },
      include: this.include(),
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Reservation not found',
      });
    }
    return row;
  }

  private include() {
    return {
      part: true,
      warehouse: true,
      workOrder: { select: { id: true, number: true, branchId: true } },
    } satisfies Prisma.StockReservationInclude;
  }

  private toDto(
    row: Prisma.StockReservationGetPayload<{
      include: ReturnType<ReservationService['include']>;
    }>,
  ) {
    const qty = Number(row.qty);
    const qtyConsumed = Number(row.qtyConsumed);
    return {
      id: row.id,
      status: row.status,
      qty,
      qtyConsumed,
      qtyRemaining: qty - qtyConsumed,
      partId: row.partId,
      sku: row.part.sku,
      nameEn: row.part.nameEn,
      nameAr: row.part.nameAr,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      workOrderId: row.workOrderId,
      wo: row.workOrder.number,
      visitId: row.visitId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
