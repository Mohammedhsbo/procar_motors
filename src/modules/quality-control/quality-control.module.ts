import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VehicleVisitsModule } from '../vehicle-visits/vehicle-visits.module';
import { WorkOrderStateMachineService } from '../work-orders/work-order-state-machine.service';
import { QualityControlController } from './quality-control.controller';
import { QualityControlService } from './quality-control.service';

@Module({
  imports: [AuditModule, VehicleVisitsModule],
  controllers: [QualityControlController],
  providers: [QualityControlService, WorkOrderStateMachineService],
  exports: [QualityControlService],
})
export class QualityControlModule {}
