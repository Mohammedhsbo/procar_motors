import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';

@Module({
  imports: [AuditModule, InventoryModule, SuppliersModule],
  controllers: [
    PurchaseRequestsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
  ],
  providers: [
    PurchaseRequestsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
  ],
  exports: [
    PurchaseRequestsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
  ],
})
export class PurchasingModule {}
