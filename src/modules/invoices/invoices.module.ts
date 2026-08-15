import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuotationCalculatorService } from '../quotations/quotation-calculator.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuditModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, QuotationCalculatorService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
