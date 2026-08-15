import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReservationService } from './reservation.service';
import { StockService } from './stock.service';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService, ReservationService, StockService],
  exports: [InventoryService, ReservationService, StockService],
})
export class InventoryModule {}
