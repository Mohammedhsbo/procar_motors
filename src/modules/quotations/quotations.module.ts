import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VehicleVisitsModule } from '../vehicle-visits/vehicle-visits.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuotationCalculatorService } from './quotation-calculator.service';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [
    AuditModule,
    VehicleVisitsModule,
    WorkOrdersModule,
    InventoryModule,
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationCalculatorService],
  exports: [QuotationsService, QuotationCalculatorService],
})
export class QuotationsModule {}
