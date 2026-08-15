import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VehicleVisitsModule } from '../vehicle-visits/vehicle-visits.module';
import { QuotationCalculatorService } from '../quotations/quotation-calculator.service';
import { WorkOrderStateMachineService } from './work-order-state-machine.service';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [AuditModule, VehicleVisitsModule],
  controllers: [WorkOrdersController],
  providers: [
    WorkOrdersService,
    WorkOrderStateMachineService,
    QuotationCalculatorService,
  ],
  exports: [WorkOrdersService, WorkOrderStateMachineService],
})
export class WorkOrdersModule {}
