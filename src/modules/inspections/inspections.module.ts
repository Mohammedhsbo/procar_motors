import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VehicleVisitsModule } from '../vehicle-visits/vehicle-visits.module';
import { InspectionTemplatesController } from './inspection-templates.controller';
import { InspectionTemplatesService } from './inspection-templates.service';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  imports: [AuditModule, VehicleVisitsModule],
  controllers: [InspectionTemplatesController, InspectionsController],
  providers: [InspectionTemplatesService, InspectionsService],
  exports: [InspectionTemplatesService, InspectionsService],
})
export class InspectionsModule {}
