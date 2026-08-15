import { DomainEventBus } from './domain-event-bus.service';

describe('DomainEventBus', () => {
  it('delivers published outbox events to subscribers', () => {
    const bus = new DomainEventBus();
    const seen: string[] = [];
    bus.onAll((e) => seen.push(e.eventType));
    bus.publish({
      outboxEventId: 'o1',
      eventType: 'vehicle.visit.created',
      payload: { visitId: 'v1' },
    });
    expect(seen).toEqual(['vehicle.visit.created']);
  });
});
