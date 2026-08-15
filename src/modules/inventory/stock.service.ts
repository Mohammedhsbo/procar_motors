import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DomainEventsService } from '../../common/services/domain-events.service';

type Tx = Prisma.TransactionClient;

export type LockedBalance = {
  id: string;
  warehouseId: string;
  partId: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  binLocation: string | null;
  version: number;
};

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  available(
    onHand: Prisma.Decimal | number,
    reserved: Prisma.Decimal | number,
  ) {
    return Number(onHand) - Number(reserved);
  }

  async lockBalance(
    tx: Tx,
    warehouseId: string,
    partId: string,
  ): Promise<LockedBalance> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        warehouse_id: string;
        part_id: string;
        on_hand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        bin_location: string | null;
        version: number;
      }>
    >`
      SELECT id, warehouse_id, part_id, on_hand, reserved, bin_location, version
      FROM inventory.stock_balances
      WHERE warehouse_id = ${warehouseId}::uuid
        AND part_id = ${partId}::uuid
      FOR UPDATE
    `;

    if (!rows[0]) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Stock balance not found for warehouse/part',
        details: { warehouseId, partId },
      });
    }

    const row = rows[0];
    return {
      id: row.id,
      warehouseId: row.warehouse_id,
      partId: row.part_id,
      onHand: row.on_hand,
      reserved: row.reserved,
      binLocation: row.bin_location,
      version: row.version,
    };
  }

  async ensureBalance(
    tx: Tx,
    warehouseId: string,
    partId: string,
  ): Promise<LockedBalance> {
    await tx.stockBalance.upsert({
      where: { warehouseId_partId: { warehouseId, partId } },
      update: {},
      create: {
        warehouseId,
        partId,
        onHand: 0,
        reserved: 0,
      },
    });
    return this.lockBalance(tx, warehouseId, partId);
  }

  assertConsistent(onHand: number, reserved: number) {
    if (onHand < 0 || reserved < 0 || reserved > onHand) {
      throw new ConflictException({
        code: ErrorCodes.INSUFFICIENT_STOCK,
        message: 'Invalid stock balance after mutation',
        details: { onHand, reserved, available: onHand - reserved },
      });
    }
  }

  /**
   * Mutate stock under FOR UPDATE + version check.
   * Pure reserve/release: no ledger row (architecture §12.2).
   * Physical movements: immutable inventory_transactions row.
   */
  async applyMutation(
    tx: Tx,
    params: {
      organizationId: string;
      branchId: string;
      warehouseId: string;
      partId: string;
      deltaOnHand: number;
      deltaReserved: number;
      type: InventoryTxnType;
      unitCost?: number | null;
      referenceType?: string | null;
      referenceId?: string | null;
      notes?: string | null;
      actorId?: string | null;
      requireAvailable?: number;
      writeLedger?: boolean;
    },
  ) {
    const balance = await this.ensureBalance(
      tx,
      params.warehouseId,
      params.partId,
    );

    if (params.requireAvailable !== undefined) {
      const available = this.available(balance.onHand, balance.reserved);
      if (available + 1e-9 < params.requireAvailable) {
        throw new ConflictException({
          code: ErrorCodes.INSUFFICIENT_STOCK,
          message: 'Insufficient available stock',
          details: {
            available,
            required: params.requireAvailable,
            partId: params.partId,
            warehouseId: params.warehouseId,
          },
        });
      }
    }

    const onHand = Number(balance.onHand) + params.deltaOnHand;
    const reserved = Number(balance.reserved) + params.deltaReserved;
    this.assertConsistent(onHand, reserved);

    const updated = await tx.stockBalance.updateMany({
      where: { id: balance.id, version: balance.version },
      data: {
        onHand,
        reserved,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: ErrorCodes.OPTIMISTIC_LOCK,
        message: 'Stock balance was modified by another request',
      });
    }

    const writeLedger =
      params.writeLedger ??
      (params.deltaOnHand !== 0 &&
        [
          'purchase_in',
          'issue',
          'return',
          'adjustment',
          'transfer_out',
          'transfer_in',
          'consume',
        ].includes(params.type));

    let transactionId: string | null = null;
    if (writeLedger) {
      const ledgerQty =
        params.type === 'consume' || params.type === 'issue'
          ? -Math.abs(params.deltaOnHand)
          : params.deltaOnHand;
      const txn = await tx.inventoryTransaction.create({
        data: {
          organizationId: params.organizationId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          partId: params.partId,
          type: params.type,
          qty: ledgerQty,
          unitCost: params.unitCost ?? null,
          referenceType: params.referenceType ?? null,
          referenceId: params.referenceId ?? null,
          notes: params.notes ?? null,
          createdBy: params.actorId ?? null,
        },
      });
      transactionId = txn.id;
    }

    await this.events.emit(
      'inventory.stock.changed',
      {
        warehouseId: params.warehouseId,
        partId: params.partId,
        onHand,
        reserved,
        available: onHand - reserved,
        type: params.type,
        transactionId,
      },
      tx,
    );

    return {
      onHand,
      reserved,
      available: onHand - reserved,
      version: balance.version + 1,
      transactionId,
    };
  }

  async refreshAlert(
    tx: Tx,
    params: {
      branchId: string;
      warehouseId: string;
      partId: string;
      onHand: number;
      reserved: number;
      minStock: number;
    },
  ) {
    const available = params.onHand - params.reserved;
    const open = await tx.stockAlert.findFirst({
      where: {
        warehouseId: params.warehouseId,
        partId: params.partId,
        status: 'open',
      },
    });

    if (available <= 0 || available < params.minStock) {
      const level = available <= 0 ? 'out' : 'low';
      if (open) {
        if (open.level !== level) {
          await tx.stockAlert.update({
            where: { id: open.id },
            data: { level },
          });
        }
      } else {
        await tx.stockAlert.create({
          data: {
            branchId: params.branchId,
            warehouseId: params.warehouseId,
            partId: params.partId,
            level,
            status: 'open',
          },
        });
      }
      await this.events.emit(
        'inventory.low_stock',
        {
          partId: params.partId,
          warehouseId: params.warehouseId,
          branchId: params.branchId,
          available,
          level,
        },
        tx,
      );
      return;
    }

    if (open) {
      await tx.stockAlert.update({
        where: { id: open.id },
        data: { status: 'closed', closedAt: new Date() },
      });
    }
  }
}
