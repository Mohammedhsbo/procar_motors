import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { JobLockService } from './job-lock.service';
import { QuotationsService } from '../../modules/quotations/quotations.service';
import { LowStockScanService } from './low-stock-scan.service';
import { ReminderEngineService } from './reminder-engine.service';

export const QUEUE_OUTBOX = 'outbox-dispatch';
export const QUEUE_SCHEDULED = 'scheduled-jobs';
export const QUEUE_REPORT_EXPORT = 'report-export';

@Processor(QUEUE_OUTBOX)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(private readonly dispatcher: OutboxDispatcherService) {
    super();
  }

  async process() {
    return this.dispatcher.drain(50);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Outbox job ${job.id} failed: ${err.message}`);
  }
}

@Processor(QUEUE_SCHEDULED)
export class ScheduledJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledJobsProcessor.name);

  constructor(
    private readonly locks: JobLockService,
    private readonly quotations: QuotationsService,
    private readonly lowStock: LowStockScanService,
    private readonly reminders: ReminderEngineService,
  ) {
    super();
  }

  async process(job: Job<{ kind: string }>) {
    const kind = job.name || job.data?.kind;
    if (kind === 'quotation-expiry') {
      const unlock = await this.locks.tryLock('quotation-expiry', 55_000);
      if (!unlock) {
        this.logger.debug('quotation-expiry skipped — lock held');
        return { skipped: true, reason: 'lock' };
      }
      try {
        const result = await this.quotations.expireOverdue();
        this.logger.log(`quotation-expiry expired=${result.expired}`);
        return result;
      } finally {
        await unlock();
      }
    }

    if (kind === 'low-stock-scan') {
      const unlock = await this.locks.tryLock('low-stock-scan', 10 * 60_000);
      if (!unlock) {
        this.logger.debug('low-stock-scan skipped — lock held');
        return { skipped: true, reason: 'lock' };
      }
      try {
        return await this.lowStock.scan();
      } finally {
        await unlock();
      }
    }

    if (kind === 'reminders') {
      const unlock = await this.locks.tryLock('reminders', 10 * 60_000);
      if (!unlock) {
        this.logger.debug('reminders skipped — lock held');
        return { skipped: true, reason: 'lock' };
      }
      try {
        return await this.reminders.run();
      } finally {
        await unlock();
      }
    }

    this.logger.warn(`Unknown scheduled job: ${kind}`);
    return { skipped: true, reason: 'unknown' };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Scheduled job ${job.name} failed: ${err.message}`);
  }
}
