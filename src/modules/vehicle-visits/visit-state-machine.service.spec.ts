import { VisitStatus } from '@prisma/client';
import { VisitStateMachineService } from './visit-state-machine.service';

describe('VisitStateMachineService', () => {
  const sm = new VisitStateMachineService();

  it('allows waiting → inspection', () => {
    expect(sm.canTransition('waiting', 'inspection')).toBe(true);
  });

  it('rejects waiting → completed', () => {
    expect(sm.canTransition('waiting', 'completed')).toBe(false);
  });

  it('rejects same-status transition', () => {
    expect(sm.canTransition('inProgress', 'inProgress')).toBe(false);
  });

  it('assertCanTransition throws on illegal move', () => {
    expect(() => sm.assertCanTransition('completed', 'waiting')).toThrow(
      /Invalid visit status transition/,
    );
    sm.assertCanTransition('waiting', 'inspection');
  });

  it('lists allowed targets', () => {
    expect(sm.allowedTargets('qualityCheck')).toEqual([
      'readyForDelivery',
      'inProgress',
    ] as VisitStatus[]);
  });

  it.each([
    ['waiting', 'inspection', true],
    ['inspection', 'waitingApproval', true],
    ['waitingApproval', 'readyForRepair', true],
    ['readyForRepair', 'inProgress', true],
    ['inProgress', 'waitingParts', true],
    ['inProgress', 'qualityCheck', true],
    ['waitingParts', 'inProgress', true],
    ['qualityCheck', 'readyForDelivery', true],
    ['qualityCheck', 'inProgress', true],
    ['readyForDelivery', 'completed', true],
    ['completed', 'waiting', false],
    ['waiting', 'completed', false],
    ['readyForDelivery', 'inProgress', false],
  ] as Array<[VisitStatus, VisitStatus, boolean]>)(
    '%s → %s = %s',
    (from, to, allowed) => {
      expect(sm.canTransition(from, to)).toBe(allowed);
    },
  );
});
