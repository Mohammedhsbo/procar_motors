import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StockService } from '../../modules/inventory/stock.service';
import { DomainEventsService } from '../../common/services/domain-events.service';

@Injectable()
export class LowStockScanService {
  private readonly logger = new Logger(LowStockScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly events: DomainEventsService,
  ) {}

  /**
   * Nightly reconciliation: refresh alerts for all balances.
   * Idempotent — refreshAlert only emits when alert state changes.
   */
  async scan() {
    const balances = await this.prisma.stockBalance.findMany({
      include: {
        part: { select: { id: true, minStock: true } },
        warehouse: { select: { id: true, branchId: true } },
      },
      take: 5000,
    });

    let checked = 0;
    let alerts = 0;
    for (const b of balances) {
      checked += 1;
      const onHand = Number(b.onHand);
      const reserved = Number(b.reserved);
      const available = onHand - reserved;
      const minStock = Number(b.part.minStock);
      await this.prisma.$transaction(async (tx) => {
        await this.stock.refreshAlert(tx, {
          branchId: b.warehouse.branchId,
          warehouseId: b.warehouseId,
          partId: b.partId,
          onHand,
          reserved,
          minStock,
        });
      });
      if (available <= 0 || available < minStock) alerts += 1;
    }

    this.logger.log(
      `Low-stock scan checked=${checked} alertCandidates=${alerts}`,
    );
    await this.events.emit('inventory.low_stock.scan.completed', {
      checked,
      alerts,
    });
    return { checked, alerts };
  }
}
