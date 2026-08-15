import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VehicleVisitsModule } from '../vehicle-visits/vehicle-visits.module';
import { FilesModule } from '../files/files.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { ConflictResolverService } from './conflict-resolver.service';

@Module({
  imports: [
    AuditModule,
    CustomersModule,
    VehiclesModule,
    VehicleVisitsModule,
    FilesModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, ConflictResolverService],
  exports: [SyncService],
})
export class SyncModule {}
