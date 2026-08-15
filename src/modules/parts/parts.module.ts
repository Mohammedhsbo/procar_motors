import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StockService } from '../inventory/stock.service';
import { PartsController } from './parts.controller';
import { PartsService } from './parts.service';

@Module({
  imports: [AuditModule],
  controllers: [PartsController],
  providers: [PartsService, StockService],
  exports: [PartsService],
})
export class PartsModule {}
