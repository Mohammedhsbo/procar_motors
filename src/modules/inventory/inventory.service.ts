import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';
import { StockService } from './stock.service';
import { ReservationService } from './reservation.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly reservations: ReservationService,
    private readonly audit: AuditService,
  ) {}

  async summary(organizationId: string, branchId: string) {
    const warehouseIds = await this.branchWarehouseIds(branchId);
    const balances = await this.prisma.stockBalance.findMany({
      where: { warehouseId: { in: warehouseIds }, part: { organizationId } },
      include: { part: true },
    });

    let skus = 0;
    let low = 0;
    let out = 0;
    let stockValue = 0;
    for (const b of balances) {
      skus += 1;
      const available = this.stock.available(b.onHand, b.reserved);
      stockValue += Number(b.onHand) * Number(b.part.costPrice);
      if (available <= 0) out += 1;
      else if (available < b.part.minStock) low += 1;
    }

    const openAlerts = await this.prisma.stockAlert.count({
      where: { branchId, status: 'open' },
    });

    return {
      skus,
      lowStock: low,
      outOfStock: out,
      openAlerts,
      stockValue: Math.round(stockValue * 100) / 100,
    };
  }

  async balances(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      warehouseId?: string;
      q?: string;
      status?: 'ok' | 'low' | 'out';
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const warehouseIds = query.warehouseId
      ? [query.warehouseId]
      : await this.branchWarehouseIds(branchId);

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        part: {
          organizationId,
          deletedAt: null,
          ...(query.q
            ? {
                OR: [
                  { sku: { contains: query.q, mode: 'insensitive' } },
                  { nameEn: { contains: query.q, mode: 'insensitive' } },
                  { nameAr: { contains: query.q, mode: 'insensitive' } },
                  { barcode: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        part: { include: { category: true } },
        warehouse: true,
      },
      orderBy: { part: { sku: 'asc' } },
    });

    const mapped = balances.map((b) => {
      const available = this.stock.available(b.onHand, b.reserved);
      const reserved = Number(b.reserved);
      let status: 'ok' | 'low' | 'out' = 'ok';
      if (available <= 0) status = 'out';
      else if (available < b.part.minStock) status = 'low';
      return {
        id: b.id,
        partId: b.partId,
        no: b.part.sku,
        sku: b.part.sku,
        nameEn: b.part.nameEn,
        nameAr: b.part.nameAr,
        en: b.part.nameEn,
        ar: b.part.nameAr,
        cat: b.part.category?.nameEn ?? null,
        catAr: b.part.category?.nameAr ?? null,
        barcode: b.part.barcode,
        brand: b.part.brand,
        unit: b.part.unit,
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        branch: b.warehouse.code,
        onHand: Number(b.onHand),
        reserved,
        available,
        min: b.part.minStock,
        max: b.part.maxStock,
        buy: Number(b.part.costPrice),
        sell: Number(b.part.sellPrice),
        loc: b.binLocation,
        status,
        version: b.version,
      };
    });

    const filtered = query.status
      ? mapped.filter((m) => m.status === query.status)
      : mapped;
    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, page * limit);
    return {
      data,
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async transactions(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; partId?: string; type?: string },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.InventoryTransactionWhereInput = {
      organizationId,
      branchId,
      ...(query.partId ? { partId: query.partId } : {}),
      ...(query.type
        ? { type: query.type as Prisma.EnumInventoryTxnTypeFilter['equals'] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.inventoryTransaction.count({ where }),
      this.prisma.inventoryTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          part: true,
          warehouse: true,
        },
      }),
    ]);

    return {
      data: rows.map((t) => ({
        id: t.id,
        type: t.type,
        qty: Number(t.qty),
        unitCost: t.unitCost != null ? Number(t.unitCost) : null,
        partId: t.partId,
        sku: t.part.sku,
        nameEn: t.part.nameEn,
        nameAr: t.part.nameAr,
        warehouseId: t.warehouseId,
        warehouseCode: t.warehouse.code,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        notes: t.notes,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
      })),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async alerts(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; status?: string },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.StockAlertWhereInput = {
      branchId,
      part: { organizationId },
      ...(query.status
        ? {
            status: query.status as Prisma.EnumStockAlertStatusFilter['equals'],
          }
        : { status: 'open' }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.stockAlert.count({ where }),
      this.prisma.stockAlert.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { part: true, warehouse: true },
      }),
    ]);

    return {
      data: rows.map((a) => ({
        id: a.id,
        level: a.level,
        status: a.status,
        partId: a.partId,
        sku: a.part.sku,
        nameEn: a.part.nameEn,
        nameAr: a.part.nameAr,
        warehouseId: a.warehouseId,
        warehouseCode: a.warehouse.code,
        openedAt: a.openedAt,
        closedAt: a.closedAt,
      })),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async adjust(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      qtyDelta: number;
      warehouseId?: string;
      notes?: string;
      unitCost?: number;
    },
  ) {
    if (dto.qtyDelta === 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'qtyDelta cannot be zero',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
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
        deltaOnHand: dto.qtyDelta,
        deltaReserved: 0,
        type: 'adjustment',
        writeLedger: true,
        actorId,
        unitCost: dto.unitCost ?? Number(part.costPrice),
        notes: dto.notes ?? null,
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
        warehouseId: warehouse.id,
        qtyDelta: dto.qtyDelta,
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
      action: 'inventory.adjustment',
      entity: 'InventoryTransaction',
      entityId: result.transactionId ?? undefined,
      after: result,
    });
    return result;
  }

  async transfer(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      partId: string;
      qty: number;
      fromWarehouseId: string;
      toWarehouseId: string;
      notes?: string;
    },
  ) {
    if (!(dto.qty > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'qty must be greater than 0',
      });
    }
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'from and to warehouses must differ',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const part = await tx.part.findFirst({
        where: { id: dto.partId, organizationId, deletedAt: null },
      });
      if (!part) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Part not found',
        });
      }
      const fromWh = await this.resolveWarehouse(
        tx,
        branchId,
        dto.fromWarehouseId,
      );
      // Allow transfer to another branch warehouse in same org — resolve by id
      const toWh = await tx.warehouse.findFirst({
        where: { id: dto.toWarehouseId },
        include: { branch: true },
      });
      if (!toWh || toWh.branch.organizationId !== organizationId) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Destination warehouse not found',
        });
      }

      const out = await this.stock.applyMutation(tx, {
        organizationId,
        branchId,
        warehouseId: fromWh.id,
        partId: part.id,
        deltaOnHand: -dto.qty,
        deltaReserved: 0,
        type: 'transfer_out',
        writeLedger: true,
        requireAvailable: dto.qty,
        actorId,
        notes: dto.notes ?? null,
        referenceType: 'transfer',
        referenceId: toWh.id,
      });

      const inn = await this.stock.applyMutation(tx, {
        organizationId,
        branchId: toWh.branchId,
        warehouseId: toWh.id,
        partId: part.id,
        deltaOnHand: dto.qty,
        deltaReserved: 0,
        type: 'transfer_in',
        writeLedger: true,
        actorId,
        notes: dto.notes ?? null,
        referenceType: 'transfer',
        referenceId: fromWh.id,
      });

      await this.stock.refreshAlert(tx, {
        branchId,
        warehouseId: fromWh.id,
        partId: part.id,
        onHand: out.onHand,
        reserved: out.reserved,
        minStock: part.minStock,
      });
      await this.stock.refreshAlert(tx, {
        branchId: toWh.branchId,
        warehouseId: toWh.id,
        partId: part.id,
        onHand: inn.onHand,
        reserved: inn.reserved,
        minStock: part.minStock,
      });

      return {
        partId: part.id,
        qty: dto.qty,
        fromWarehouseId: fromWh.id,
        toWarehouseId: toWh.id,
        fromAvailable: out.available,
        toAvailable: inn.available,
      };
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'inventory.transfer',
      entity: 'Part',
      entityId: dto.partId,
      after: result,
    });
    return result;
  }

  /** Called from quotation approve — reserve part lines onto WO */
  async reserveFromApprovedQuotationInTx(
    tx: Tx,
    params: {
      organizationId: string;
      branchId: string;
      actorId: string;
      workOrderId: string;
      visitId: string;
      items: Array<{ partId: string | null; qty: number; kind: string }>;
    },
  ) {
    const partLines = params.items.filter(
      (i) => i.kind === 'part' && i.partId && Number(i.qty) > 0,
    );
    if (!partLines.length) {
      return { reserved: [], unavailable: [], deferred_purchase: [] };
    }

    const reserved: Array<{
      partId: string;
      reservationId: string;
      qty: number;
    }> = [];
    const unavailable: Array<{
      partId: string;
      qty: number;
      available: number;
    }> = [];

    for (const line of partLines) {
      try {
        const dto = await this.reservations.reserveInTx(
          tx,
          params.organizationId,
          params.branchId,
          params.actorId,
          {
            partId: line.partId!,
            qty: Number(line.qty),
            workOrderId: params.workOrderId,
            visitId: params.visitId,
          },
        );
        reserved.push({
          partId: line.partId!,
          reservationId: dto.id,
          qty: Number(line.qty),
        });
      } catch (e) {
        if (e instanceof ConflictException) {
          const body = e.getResponse() as {
            code?: string;
            details?: { available?: number };
          };
          if (body?.code === ErrorCodes.INSUFFICIENT_STOCK) {
            unavailable.push({
              partId: line.partId!,
              qty: Number(line.qty),
              available: body.details?.available ?? 0,
            });
            continue;
          }
        }
        throw e;
      }
    }

    return {
      reserved,
      unavailable,
      deferred_purchase: unavailable.map((u) => ({
        partId: u.partId,
        qty: u.qty,
        hook: 'deferred_to_phase_12',
        endpoint: 'POST /api/v1/purchase-requests/from-unavailable',
      })),
    };
  }

  private async branchWarehouseIds(branchId: string) {
    const rows = await this.prisma.warehouse.findMany({
      where: { branchId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
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
        message: 'Default warehouse not found',
      });
    }
    return def;
  }
}
