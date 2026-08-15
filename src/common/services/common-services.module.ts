import { Global, Module } from '@nestjs/common';
import { DomainEventsService } from './domain-events.service';
import { DomainEventBus } from './domain-event-bus.service';
import { EcosystemEventHooks } from './ecosystem-event.hooks';
import { IdempotencyService } from './idempotency.service';
import { NumberSequenceService } from './number-sequence.service';

@Global()
@Module({
  providers: [
    NumberSequenceService,
    IdempotencyService,
    DomainEventsService,
    DomainEventBus,
    EcosystemEventHooks,
  ],
  exports: [
    NumberSequenceService,
    IdempotencyService,
    DomainEventsService,
    DomainEventBus,
  ],
})
export class CommonServicesModule {}
