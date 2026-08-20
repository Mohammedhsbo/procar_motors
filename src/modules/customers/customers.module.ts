import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer360Service } from './customer-360.service';

@Module({
  imports: [AuditModule],
  controllers: [CustomersController],
  providers: [CustomersService, Customer360Service],
  exports: [CustomersService, Customer360Service],
})
export class CustomersModule {}
