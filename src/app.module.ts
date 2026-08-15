import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { EnvConfig } from './config/env.validation';
import { AppConfigModule } from './config/config.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CustomersModule } from './modules/customers/customers.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { FilesModule } from './modules/files/files.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RolesModule } from './modules/roles/roles.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { VehicleVisitsModule } from './modules/vehicle-visits/vehicle-visits.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { InspectionsModule } from './modules/inspections/inspections.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module';
import { TechnicianTasksModule } from './modules/technician-tasks/technician-tasks.module';
import { WorkshopBoardModule } from './modules/workshop-board/workshop-board.module';
import { QualityControlModule } from './modules/quality-control/quality-control.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PartsModule } from './modules/parts/parts.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { TaxesModule } from './modules/taxes/taxes.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PortalModule } from './modules/portal/portal.module';
import { SyncModule } from './modules/sync/sync.module';
import { UxpModule } from './modules/uxp/uxp.module';
import { TireszoneModule } from './modules/tireszone/tireszone.module';
import { DailyCafeModule } from './modules/daily-cafe/daily-cafe.module';
import { JobsModule } from './infrastructure/jobs/jobs.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { CacheModule } from './infrastructure/cache/cache.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonServicesModule,
    CacheModule,
    RealtimeModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const isTest = process.env.NODE_ENV === 'test';
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        const ttl = config.get('RATE_LIMIT_TTL_MS', { infer: true });
        const limit = isProd
          ? Math.min(60, config.get('RATE_LIMIT_LIMIT', { infer: true }))
          : config.get('RATE_LIMIT_LIMIT', { infer: true });
        return {
          skipIf: () => isTest,
          throttlers: [
            { name: 'default', ttl, limit },
            { name: 'auth', ttl: 60_000, limit: 5 },
          ],
        };
      },
    }),
    AuthModule,
    RbacModule,
    OrganizationsModule,
    BranchesModule,
    UsersModule,
    EmployeesModule,
    RolesModule,
    SettingsModule,
    AuditModule,
    CustomersModule,
    VehiclesModule,
    SearchModule,
    VehicleVisitsModule,
    FilesModule,
    InspectionsModule,
    QuotationsModule,
    WorkOrdersModule,
    TechnicianTasksModule,
    WorkshopBoardModule,
    QualityControlModule,
    InventoryModule,
    PartsModule,
    SuppliersModule,
    PurchasingModule,
    TaxesModule,
    InvoicesModule,
    PaymentsModule,
    ExpensesModule,
    NotificationsModule,
    DashboardModule,
    ReportsModule,
    PortalModule,
    SyncModule,
    UxpModule,
    TireszoneModule,
    DailyCafeModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
