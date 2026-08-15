import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DomainEventBus,
  type PublishedDomainEvent,
} from './domain-event-bus.service';

/** Event → ecosystem apps that may consume later. Hooks are log-only (no business logic). */
const ECOSYSTEM_HOOKS: Record<
  string,
  Array<'uxp' | 'tireszone' | 'daily_cafe'>
> = {
  'vehicle.visit.created': ['uxp', 'tireszone', 'daily_cafe'],
  'vehicle.ready': ['uxp'],
  'quotation.approved': ['tireszone'],
  'workorder.created': ['tireszone'],
  'invoice.issued': ['uxp'],
  'payment.received': ['uxp'],
};

@Injectable()
export class EcosystemEventHooks implements OnModuleInit {
  private readonly logger = new Logger(EcosystemEventHooks.name);

  constructor(private readonly bus: DomainEventBus) {}

  onModuleInit() {
    this.bus.onAll((event) => this.handle(event));
  }

  handle(event: PublishedDomainEvent) {
    const apps = ECOSYSTEM_HOOKS[event.eventType];
    if (!apps?.length) return;
    this.logger.debug(
      `ecosystem hook apps=${apps.join(',')} event=${event.eventType} outbox=${event.outboxEventId}`,
    );
  }
}
