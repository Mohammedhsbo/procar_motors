import { TechnicianTasksService } from './technician-tasks.service';

describe('TechnicianTasksService timers', () => {
  it('accumulates elapsed seconds from startedAt', () => {
    const startedAt = new Date('2026-08-11T10:00:00.000Z');
    const now = new Date('2026-08-11T10:02:30.000Z');
    expect(TechnicianTasksService.accumulateElapsed(10, startedAt, now)).toBe(
      160,
    ); // 10 + 150
  });

  it('ignores null startedAt', () => {
    expect(TechnicianTasksService.accumulateElapsed(42, null, new Date())).toBe(
      42,
    );
  });
});
