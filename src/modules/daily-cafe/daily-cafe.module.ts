import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DailyCafeController } from './daily-cafe.controller';
import { DailyCafeService } from './daily-cafe.service';

@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [DailyCafeController],
  providers: [DailyCafeService],
  exports: [DailyCafeService],
})
export class DailyCafeModule {}
