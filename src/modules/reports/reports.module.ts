import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_REPORT_EXPORT } from '../../infrastructure/jobs/jobs.processors';
import { ReportExportProcessor } from '../../infrastructure/jobs/report-export.processor';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_REPORT_EXPORT })],
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportProcessor],
  exports: [ReportsService],
})
export class ReportsModule {}
