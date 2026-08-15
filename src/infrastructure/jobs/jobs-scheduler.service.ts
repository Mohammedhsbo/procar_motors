import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_OUTBOX, QUEUE_SCHEDULED } from './jobs.processors';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

/**
 * Registers job schedulers with stable IDs (BullMQ upsertJobScheduler)
 * so restarts / multiple Nest instances do not create duplicate schedules.
 */
@Injectable()
export class JobsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(JobsSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_OUTBOX) private readonly outboxQueue: Queue,
    @InjectQueue(QUEUE_SCHEDULED) private readonly scheduledQueue: Queue,
    private readonly dispatcher: OutboxDispatcherService,
  ) {}

  async onModuleInit() {
    if (process.env.JOB_SCHEDULER_ENABLED === 'false') {
      this.logger.log(
        'Job schedulers skipped (JOB_SCHEDULER_ENABLED=false); processors still consume queues',
      );
      return;
    }

    // Drain outbox frequently. upsertJobScheduler uses stable IDs so extra
    // API replicas do not create duplicate cron/repeat schedules.
    await this.outboxQueue.upsertJobScheduler(
      'outbox-drain-repeat',
      { every: 3_000 },
      {
        name: 'drain',
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 50 },
      },
    );

    // Quotation expiry — every hour (idempotent); nightly intent covered
    await this.scheduledQueue.upsertJobScheduler(
      'quotation-expiry-repeat',
      { pattern: '5 * * * *' }, // minute 5 every hour
      {
        name: 'quotation-expiry',
        data: { kind: 'quotation-expiry' },
        opts: { removeOnComplete: 20, removeOnFail: 20 },
      },
    );

    // Low-stock scan — nightly 02:15
    await this.scheduledQueue.upsertJobScheduler(
      'low-stock-scan-repeat',
      { pattern: '15 2 * * *' },
      {
        name: 'low-stock-scan',
        data: { kind: 'low-stock-scan' },
        opts: { removeOnComplete: 20, removeOnFail: 20 },
      },
    );

    this.logger.log(
      'Job schedulers registered: outbox-drain, quotation-expiry, low-stock-scan',
    );

    // Immediate kick so smoke/e2e don't wait for first tick
    if (process.env.NODE_ENV !== 'production') {
      await this.dispatcher.drain(20).catch((err) => {
        this.logger.warn(
          `Initial outbox drain failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  /** Test/smoke helper — run jobs on demand */
  async runNow(kind: 'quotation-expiry' | 'low-stock-scan' | 'outbox-drain') {
    if (kind === 'outbox-drain') {
      return this.dispatcher.drain(100);
    }
    const job = await this.scheduledQueue.add(
      kind,
      { kind },
      { jobId: `${kind}-manual-${Date.now()}`, removeOnComplete: true },
    );
    return { jobId: job.id, name: kind };
  }
}
