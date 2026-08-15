import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { JobTicketsController } from './job-tickets.controller';
import { JobTicketsService } from './job-tickets.service';
import { VehicleVisitsController } from './vehicle-visits.controller';
import { VehicleVisitsService } from './vehicle-visits.service';
import { VisitStateMachineService } from './visit-state-machine.service';

@Module({
  imports: [AuditModule, InvoicesModule],
  controllers: [VehicleVisitsController, JobTicketsController],
  providers: [
    VehicleVisitsService,
    JobTicketsService,
    VisitStateMachineService,
  ],
  exports: [VehicleVisitsService, JobTicketsService, VisitStateMachineService],
})
export class VehicleVisitsModule {}
