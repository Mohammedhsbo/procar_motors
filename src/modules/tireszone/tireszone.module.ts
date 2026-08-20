import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TireszoneController } from './tireszone.controller';
import { TireszoneService } from './tireszone.service';

@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [TireszoneController],
  providers: [TireszoneService],
  exports: [TireszoneService],
})
export class TireszoneModule {}
