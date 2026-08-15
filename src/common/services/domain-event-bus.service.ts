import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type PublishedDomainEvent = {
  outboxEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

/**
 * In-process bus for published outbox events (architecture §20.5).
 * Future: replace subscribers with a message queue for separate app consumers.
 */
@Injectable()
export class DomainEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  publish(event: PublishedDomainEvent) {
    this.emitter.emit('domain', event);
    this.emitter.emit(event.eventType, event);
  }

  onAll(listener: (event: PublishedDomainEvent) => void) {
    this.emitter.on('domain', listener);
    return () => {
      this.emitter.off('domain', listener);
    };
  }
}
