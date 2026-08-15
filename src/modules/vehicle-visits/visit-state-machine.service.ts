import { Injectable } from '@nestjs/common';
import { VisitStatus } from '@prisma/client';

/**
 * Visit-level allowed transitions (architecture §11.2 condensed to status graph).
 * Action-specific gates (QC pass, payment) enforced in later phases.
 */
const ALLOWED: Record<VisitStatus, VisitStatus[]> = {
  waiting: ['inspection'],
  inspection: ['waitingApproval'],
  waitingApproval: ['readyForRepair', 'waitingApproval'],
  readyForRepair: ['inProgress', 'waitingApproval'],
  inProgress: ['waitingParts', 'qualityCheck', 'inProgress', 'waitingApproval'],
  waitingParts: ['inProgress', 'waitingApproval'],
  qualityCheck: ['readyForDelivery', 'inProgress'],
  readyForDelivery: ['completed'],
  completed: [],
};

@Injectable()
export class VisitStateMachineService {
  canTransition(from: VisitStatus, to: VisitStatus): boolean {
    if (from === to) return false;
    return (ALLOWED[from] ?? []).includes(to);
  }

  assertCanTransition(from: VisitStatus, to: VisitStatus): void {
    if (!this.canTransition(from, to)) {
      const err = new Error(
        `Invalid visit status transition: ${from} → ${to}`,
      ) as Error & { code: string; from: VisitStatus; to: VisitStatus };
      err.code = 'INVALID_STATUS_TRANSITION';
      err.from = from;
      err.to = to;
      throw err;
    }
  }

  allowedTargets(from: VisitStatus): VisitStatus[] {
    return [...(ALLOWED[from] ?? [])];
  }
}
