import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { VisitStateMachineService } from '../vehicle-visits/visit-state-machine.service';
import { WorkOrderStateMachineService } from '../work-orders/work-order-state-machine.service';
import { WorkshopRealtimeService } from '../../infrastructure/realtime/workshop-realtime.service';
import { DEFAULT_QC_CHECKLIST } from '../../common/constants/qc-checklist';

@Injectable()
export class QualityControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSm: VisitStateMachineService,
    private readonly woSm: WorkOrderStateMachineService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly realtime: WorkshopRealtimeService,
  ) {}

  async getById(organizationId: string, id: string) {
    const qc = await this.findOrFail(organizationId, id);
    return this.toDto(qc);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: { workOrderId: string; visitId?: string },
  ) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: dto.workOrderId, organizationId },
      include: { visit: true },
    });
    if (!wo) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Work order not found',
      });
    }
    if (dto.visitId && dto.visitId !== wo.visitId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'visitId does not match work order visit',
      });
    }
    if (wo.status !== 'qc' && wo.visit.status !== 'qualityCheck') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Work order / visit must be in QC before creating a checklist',
      });
    }

    const existing = await this.prisma.qualityCheck.findFirst({
      where: { workOrderId: wo.id, status: 'pending' },
      include: this.include(),
    });
    if (existing) {
      return this.toDto(existing);
    }

    const created = await this.prisma.qualityCheck.create({
      data: {
        visitId: wo.visitId,
        workOrderId: wo.id,
        inspectorId: actorId,
        status: 'pending',
        items: {
          create: DEFAULT_QC_CHECKLIST.map((item) => ({
            labelEn: item.labelEn,
            labelAr: item.labelAr,
          })),
        },
      },
      include: this.include(),
    });

    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'quality_check.create',
      entity: 'QualityCheck',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  async updateItems(
    organizationId: string,
    actorId: string,
    id: string,
    items: Array<{ id: string; passed: boolean | null }>,
  ) {
    const qc = await this.findOrFail(organizationId, id);
    if (qc.status !== 'pending') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot update items on quality check in status ${qc.status}`,
      });
    }

    const itemIds = new Set(qc.items.map((i) => i.id));
    for (const item of items) {
      if (!itemIds.has(item.id)) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Item ${item.id} does not belong to this quality check`,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.qualityCheckItem.update({
          where: { id: item.id },
          data: { passed: item.passed },
        });
      }
      await tx.qualityCheck.update({
        where: { id },
        data: { inspectorId: actorId },
      });
    });

    const refreshed = await this.findOrFail(organizationId, id);
    const result = this.toDto(refreshed);
    await this.audit.log({
      organizationId,
      branchId: qc.workOrder.branchId,
      actorId,
      action: 'quality_check.update_items',
      entity: 'QualityCheck',
      entityId: id,
      after: result,
    });
    return result;
  }

  async pass(organizationId: string, actorId: string, id: string) {
    const qc = await this.findOrFail(organizationId, id);
    if (qc.status !== 'pending') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot pass quality check in status ${qc.status}`,
      });
    }

    const incomplete = qc.items.filter((i) => i.passed !== true);
    if (incomplete.length > 0) {
      throw new ConflictException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'All QC checklist items must pass before approval',
        details: {
          incompleteItemIds: incomplete.map((i) => i.id),
          incompleteCount: incomplete.length,
        },
      });
    }

    if (qc.visit.status !== 'qualityCheck') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Visit must be qualityCheck to pass QC (current: ${qc.visit.status})`,
      });
    }
    if (!this.visitSm.canTransition('qualityCheck', 'readyForDelivery')) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Visit cannot move to readyForDelivery',
      });
    }
    if (
      qc.workOrder.status === 'qc' &&
      !this.woSm.canTransition('qc', 'completed')
    ) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Work order cannot move to completed from qc',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const qcMoved = await tx.qualityCheck.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'passed',
          inspectorId: actorId,
          decidedAt: new Date(),
        },
      });
      if (qcMoved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quality check was modified by another request',
        });
      }

      const visitMoved = await tx.vehicleVisit.updateMany({
        where: { id: qc.visitId, version: qc.visit.version },
        data: {
          status: 'readyForDelivery',
          version: { increment: 1 },
          updatedBy: actorId,
          progressPct: 95,
        },
      });
      if (visitMoved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Visit was modified by another request',
        });
      }

      if (qc.workOrder.status === 'qc') {
        await tx.workOrder.updateMany({
          where: { id: qc.workOrderId, status: 'qc' },
          data: {
            status: 'completed',
            completedAt: new Date(),
            progressPct: 100,
          },
        });
        await this.events.emit(
          'workorder.status.changed',
          {
            workOrderId: qc.workOrderId,
            from: 'qc',
            to: 'completed',
          },
          tx,
        );
      }

      await this.events.emit(
        'vehicle.status.changed',
        {
          visitId: qc.visitId,
          from: 'qualityCheck',
          to: 'readyForDelivery',
        },
        tx,
      );
      await this.events.emit(
        'vehicle.ready',
        {
          organizationId,
          branchId: qc.visit.branchId,
          visitId: qc.visitId,
          workOrderId: qc.workOrderId,
          qualityCheckId: id,
        },
        tx,
      );

      return tx.qualityCheck.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    this.realtime.emitVisitStatusChanged({
      branchId: qc.workOrder.branchId,
      visitId: qc.visitId,
      from: 'qualityCheck',
      to: 'readyForDelivery',
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: qc.workOrder.branchId,
      actorId,
      action: 'quality_check.pass',
      entity: 'QualityCheck',
      entityId: id,
      after: result,
    });
    return {
      ...result,
      visitStatus: 'readyForDelivery' as const,
      workOrderStatus: 'completed' as const,
    };
  }

  async fail(
    organizationId: string,
    actorId: string,
    id: string,
    dto: { reason: string },
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Failure reason is required',
      });
    }

    const qc = await this.findOrFail(organizationId, id);
    if (qc.status !== 'pending') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot fail quality check in status ${qc.status}`,
      });
    }
    if (qc.visit.status !== 'qualityCheck') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Visit must be qualityCheck to fail QC (current: ${qc.visit.status})`,
      });
    }
    if (!this.visitSm.canTransition('qualityCheck', 'inProgress')) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Visit cannot return to inProgress',
      });
    }

    const reason = dto.reason.trim();
    const failedItems = qc.items.filter((i) => i.passed === false);
    if (failedItems.length === 0) {
      throw new ConflictException({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          'At least one checklist item must be marked failed before rejecting QC',
        details: { failedItemCount: 0 },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const qcMoved = await tx.qualityCheck.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'failed',
          inspectorId: actorId,
          decidedAt: new Date(),
          notes: reason,
        },
      });
      if (qcMoved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Quality check was modified by another request',
        });
      }

      const visitMoved = await tx.vehicleVisit.updateMany({
        where: { id: qc.visitId, version: qc.visit.version },
        data: {
          status: 'inProgress',
          version: { increment: 1 },
          updatedBy: actorId,
          progressPct: 60,
        },
      });
      if (visitMoved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Visit was modified by another request',
        });
      }

      if (qc.workOrder.status === 'qc') {
        await tx.workOrder.updateMany({
          where: { id: qc.workOrderId, status: 'qc' },
          data: { status: 'in_progress', progressPct: 70 },
        });
        await this.events.emit(
          'workorder.status.changed',
          {
            workOrderId: qc.workOrderId,
            from: 'qc',
            to: 'in_progress',
            reason,
          },
          tx,
        );
      }

      const maxSort = await tx.technicianTask.aggregate({
        where: { workOrderId: qc.workOrderId },
        _max: { sortOrder: true },
      });
      const reworkTask = await tx.technicianTask.create({
        data: {
          workOrderId: qc.workOrderId,
          title: `Rework: ${reason}`.slice(0, 255),
          status: 'assigned',
          priority: qc.workOrder.priority,
          assigneeId: qc.workOrder.technicianId,
          sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          blockedReason: null,
        },
      });

      await this.events.emit(
        'vehicle.status.changed',
        {
          visitId: qc.visitId,
          from: 'qualityCheck',
          to: 'inProgress',
          reason,
        },
        tx,
      );
      await this.events.emit(
        'qc.failed',
        {
          organizationId,
          branchId: qc.visit.branchId,
          qualityCheckId: id,
          visitId: qc.visitId,
          workOrderId: qc.workOrderId,
          reason,
          reworkTaskId: reworkTask.id,
        },
        tx,
      );

      return {
        qc: await tx.qualityCheck.findFirstOrThrow({
          where: { id },
          include: this.include(),
        }),
        reworkTaskId: reworkTask.id,
      };
    });

    this.realtime.emitVisitStatusChanged({
      branchId: qc.workOrder.branchId,
      visitId: qc.visitId,
      from: 'qualityCheck',
      to: 'inProgress',
      reason,
    });

    const result = this.toDto(updated.qc);
    await this.audit.log({
      organizationId,
      branchId: qc.workOrder.branchId,
      actorId,
      action: 'quality_check.fail',
      entity: 'QualityCheck',
      entityId: id,
      after: { ...result, reworkTaskId: updated.reworkTaskId },
    });
    return {
      ...result,
      visitStatus: 'inProgress' as const,
      workOrderStatus: 'in_progress' as const,
      reworkTaskId: updated.reworkTaskId,
    };
  }

  /** Used by visit transition / delivery gates */
  async assertQcPassedForVisit(visitId: string) {
    const passed = await this.prisma.qualityCheck.findFirst({
      where: { visitId, status: 'passed' },
      orderBy: { decidedAt: 'desc' },
    });
    if (!passed) {
      throw new ConflictException({
        code: ErrorCodes.QC_REQUIRED,
        message: 'QC pass is required before readyForDelivery / delivery',
      });
    }
    return passed;
  }

  private async findOrFail(organizationId: string, id: string) {
    const qc = await this.prisma.qualityCheck.findFirst({
      where: { id, workOrder: { organizationId } },
      include: this.include(),
    });
    if (!qc) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quality check not found',
      });
    }
    return qc;
  }

  private include() {
    return {
      items: { orderBy: { labelEn: 'asc' as const } },
      visit: {
        select: {
          id: true,
          status: true,
          version: true,
          branchId: true,
        },
      },
      workOrder: {
        select: {
          id: true,
          number: true,
          status: true,
          branchId: true,
          technicianId: true,
          priority: true,
        },
      },
    } satisfies Prisma.QualityCheckInclude;
  }

  private toDto(
    qc: Prisma.QualityCheckGetPayload<{
      include: ReturnType<QualityControlService['include']>;
    }>,
  ) {
    const passedCount = qc.items.filter((i) => i.passed === true).length;
    return {
      id: qc.id,
      status: qc.status,
      notes: qc.notes,
      inspectorId: qc.inspectorId,
      decidedAt: qc.decidedAt,
      visitId: qc.visitId,
      visitStatus: qc.visit.status,
      workOrderId: qc.workOrderId,
      workOrderNumber: qc.workOrder.number,
      wo: qc.workOrder.number,
      workOrderStatus: qc.workOrder.status,
      items: qc.items.map((i) => ({
        id: i.id,
        labelEn: i.labelEn,
        labelAr: i.labelAr,
        passed: i.passed,
      })),
      itemsTotal: qc.items.length,
      itemsPassed: passedCount,
      allPassed: qc.items.length > 0 && passedCount === qc.items.length,
      createdAt: qc.createdAt,
      updatedAt: qc.updatedAt,
    };
  }
}
