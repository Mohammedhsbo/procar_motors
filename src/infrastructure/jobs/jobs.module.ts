import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { QuotationsModule } from '../../modules/quotations/quotations.module';
import { InventoryModule } from '../../modules/inventory/inventory.module';
import { JobLockService } from './job-lock.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { LowStockScanService } from './low-stock-scan.service';
import {
  OutboxProcessor,
  ScheduledJobsProcessor,
  QUEUE_OUTBOX,
  QUEUE_SCHEDULED,
} from './jobs.processors';
import { JobsSchedulerService } from './jobs-scheduler.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const url: string = config.get('REDIS_URL', { infer: true });
        return {
          connection: {
            url,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUE_OUTBOX }, { name: QUEUE_SCHEDULED }),
    NotificationsModule,
    forwardRef(() => QuotationsModule),
    InventoryModule,
  ],
  controllers: [JobsController],
  providers: [
    JobLockService,
    OutboxDispatcherService,
    LowStockScanService,
    OutboxProcessor,
    ScheduledJobsProcessor,
    JobsSchedulerService,
  ],
  exports: [OutboxDispatcherService, JobsSchedulerService, LowStockScanService],
})
export class JobsModule {}
