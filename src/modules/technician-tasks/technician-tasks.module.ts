import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { TechnicianTasksController } from './technician-tasks.controller';
import { TechnicianTasksService } from './technician-tasks.service';

@Module({
  imports: [AuditModule, WorkOrdersModule],
  controllers: [TechnicianTasksController],
  providers: [TechnicianTasksService],
  exports: [TechnicianTasksService],
})
export class TechnicianTasksModule {}
