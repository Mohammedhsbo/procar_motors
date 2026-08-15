import { Injectable, Logger } from '@nestjs/common';
import { WorkshopGateway } from './workshop.gateway';

@Injectable()
export class WorkshopRealtimeService {
  private readonly logger = new Logger(WorkshopRealtimeService.name);

  constructor(private readonly gateway: WorkshopGateway) {}

  emitVisitStatusChanged(payload: {
    branchId: string;
    visitId: string;
    from: string;
    to: string;
    reason?: string | null;
  }) {
    try {
      this.gateway.emitToWorkshop(payload.branchId, 'vehicle.status.changed', {
        visitId: payload.visitId,
        from: payload.from,
        to: payload.to,
        reason: payload.reason ?? null,
        at: new Date().toISOString(),
      });
      this.gateway.emitToBranch(payload.branchId, 'board.updated', {
        visitId: payload.visitId,
        status: payload.to,
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Realtime emit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  emitTaskChanged(payload: {
    branchId: string;
    workOrderId: string;
    taskId: string;
    event: string;
    status: string;
  }) {
    try {
      this.gateway.emitToWorkshop(payload.branchId, payload.event, {
        workOrderId: payload.workOrderId,
        taskId: payload.taskId,
        status: payload.status,
        at: new Date().toISOString(),
      });
      this.gateway.emitToWorkOrder(payload.workOrderId, payload.event, {
        workOrderId: payload.workOrderId,
        taskId: payload.taskId,
        status: payload.status,
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Realtime task emit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  emitNotification(
    userId: string,
    payload: {
      id: string;
      category: string;
      titleEn: string;
      titleAr: string;
      entityType: string | null;
      entityId: string | null;
      createdAt: Date;
    },
  ) {
    try {
      this.gateway.emitToUser(userId, 'notification.created', {
        ...payload,
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Realtime notification emit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  emitLowStock(branchId: string, payload: Record<string, unknown>) {
    try {
      this.gateway.emitToBranch(branchId, 'inventory.low_stock', {
        ...payload,
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Realtime low stock emit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
