import { Injectable } from '@nestjs/common';
import { WorkOrderStatus } from '@prisma/client';

/**
 * Work order status graph — architecture §11.4
 */
const ALLOWED: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'waiting_parts', 'qc', 'cancelled'],
  paused: ['in_progress', 'cancelled'],
  waiting_parts: ['in_progress', 'cancelled'],
  qc: ['completed', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class WorkOrderStateMachineService {
  canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
    if (from === to) return false;
    return (ALLOWED[from] ?? []).includes(to);
  }

  allowedTargets(from: WorkOrderStatus): WorkOrderStatus[] {
    return [...(ALLOWED[from] ?? [])];
  }
}
