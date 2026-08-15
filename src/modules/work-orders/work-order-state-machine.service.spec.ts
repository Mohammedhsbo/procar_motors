import { WorkOrderStatus } from '@prisma/client';
import { WorkOrderStateMachineService } from './work-order-state-machine.service';

describe('WorkOrderStateMachineService', () => {
  const sm = new WorkOrderStateMachineService();

  it('allows draft → assigned', () => {
    expect(sm.canTransition('draft', 'assigned')).toBe(true);
  });

  it('allows in_progress → qc', () => {
    expect(sm.canTransition('in_progress', 'qc')).toBe(true);
  });

  it('rejects start from draft', () => {
    expect(sm.canTransition('draft', 'in_progress')).toBe(false);
  });

  it('lists targets for assigned', () => {
    expect(sm.allowedTargets('assigned')).toEqual([
      'in_progress',
      'cancelled',
    ] as WorkOrderStatus[]);
  });

  it.each([
    ['draft', 'assigned', true],
    ['assigned', 'in_progress', true],
    ['in_progress', 'paused', true],
    ['in_progress', 'qc', true],
    ['paused', 'in_progress', true],
    ['waiting_parts', 'in_progress', true],
    ['qc', 'completed', true],
    ['qc', 'in_progress', true],
    ['completed', 'in_progress', false],
    ['cancelled', 'draft', false],
  ] as Array<[WorkOrderStatus, WorkOrderStatus, boolean]>)(
    '%s → %s = %s',
    (from, to, allowed) => {
      expect(sm.canTransition(from, to)).toBe(allowed);
    },
  );
});
