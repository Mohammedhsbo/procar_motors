import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TechnicianTaskStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DomainEventsService } from '../../common/services/domain-events.service';
import type { AuthUserContext } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { WorkshopRealtimeService } from '../../infrastructure/realtime/workshop-realtime.service';

const TASK_TRANSITIONS: Record<TechnicianTaskStatus, TechnicianTaskStatus[]> = {
  pending: ['assigned', 'in_progress', 'blocked'],
  assigned: ['in_progress', 'blocked'],
  in_progress: ['paused', 'completed', 'blocked'],
  paused: ['in_progress', 'completed', 'blocked'],
  completed: [],
  blocked: ['assigned', 'in_progress'],
};

@Injectable()
export class TechnicianTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workOrders: WorkOrdersService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly realtime: WorkshopRealtimeService,
  ) {}

  async myTasks(
    organizationId: string,
    branchId: string,
    user: AuthUserContext,
    query: { page?: number; limit?: number; status?: TechnicianTaskStatus },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const privileged = this.workOrders.isWorkshopPrivileged(user);

    const where: Prisma.TechnicianTaskWhereInput = {
      workOrder: {
        organizationId,
        branchId,
      },
      ...(privileged ? {} : { assigneeId: user.sub }),
      ...(query.status
        ? { status: query.status }
        : { status: { not: 'completed' } }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.technicianTask.count({ where }),
      this.prisma.technicianTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { sortOrder: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: this.include(),
      }),
    ]);

    return {
      data: rows.map((t) => this.toDto(t)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string, user: AuthUserContext) {
    const task = await this.findOrFail(organizationId, id);
    this.assertCanAccessTask(user, task);
    return this.toDto(task);
  }

  async start(
    organizationId: string,
    actorId: string,
    id: string,
    user: AuthUserContext,
  ) {
    const task = await this.findOrFail(organizationId, id);
    this.assertCanAccessTask(user, task, 'mutate');
    if (task.workOrder.visit.status === 'waitingApproval') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Cannot start task while visit is waitingApproval',
      });
    }
    this.assertTaskTransition(task.status, 'in_progress');

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.technicianTask.updateMany({
        where: {
          id,
          status: { in: ['pending', 'assigned', 'paused', 'blocked'] },
        },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          pausedAt: null,
          assigneeId: task.assigneeId ?? actorId,
          blockedReason: null,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Task was modified by another request',
        });
      }

      if (
        ['assigned', 'paused', 'draft'].includes(task.workOrder.status) ||
        task.workOrder.status === 'waiting_parts'
      ) {
        // keep WO in sync when first task starts
        if (
          task.workOrder.status === 'assigned' ||
          task.workOrder.status === 'paused'
        ) {
          await tx.workOrder.updateMany({
            where: { id: task.workOrderId, status: task.workOrder.status },
            data: {
              status: 'in_progress',
              startedAt: task.workOrder.startedAt ?? new Date(),
            },
          });
        }
      }

      await this.events.emit(
        'technician.task.started',
        {
          taskId: id,
          workOrderId: task.workOrderId,
          assigneeId: task.assigneeId ?? actorId,
        },
        tx,
      );

      return tx.technicianTask.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    this.realtime.emitTaskChanged({
      branchId: task.workOrder.branchId,
      workOrderId: task.workOrderId,
      taskId: id,
      event: 'technician.task.started',
      status: 'in_progress',
    });

    const dto = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: task.workOrder.branchId,
      actorId,
      action: 'technician_task.start',
      entity: 'TechnicianTask',
      entityId: id,
      after: dto,
    });
    return dto;
  }

  async pause(
    organizationId: string,
    actorId: string,
    id: string,
    user: AuthUserContext,
  ) {
    const task = await this.findOrFail(organizationId, id);
    this.assertCanAccessTask(user, task, 'mutate');
    this.assertTaskTransition(task.status, 'paused');

    const now = new Date();
    let extra = 0;
    if (task.startedAt) {
      extra = Math.floor((now.getTime() - task.startedAt.getTime()) / 1000);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.technicianTask.updateMany({
        where: { id, status: 'in_progress' },
        data: {
          status: 'paused',
          pausedAt: now,
          elapsedSeconds: task.elapsedSeconds + Math.max(0, extra),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Task was modified by another request',
        });
      }

      await this.events.emit(
        'technician.task.paused',
        {
          taskId: id,
          workOrderId: task.workOrderId,
          elapsedSeconds: task.elapsedSeconds + Math.max(0, extra),
        },
        tx,
      );

      return tx.technicianTask.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    this.realtime.emitTaskChanged({
      branchId: task.workOrder.branchId,
      workOrderId: task.workOrderId,
      taskId: id,
      event: 'technician.task.paused',
      status: 'paused',
    });

    const dto = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: task.workOrder.branchId,
      actorId,
      action: 'technician_task.pause',
      entity: 'TechnicianTask',
      entityId: id,
      after: dto,
    });
    return dto;
  }

  async complete(
    organizationId: string,
    actorId: string,
    id: string,
    user: AuthUserContext,
  ) {
    const task = await this.findOrFail(organizationId, id);
    this.assertCanAccessTask(user, task, 'mutate');
    if (!['in_progress', 'paused'].includes(task.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot complete task from status ${task.status}`,
      });
    }

    const now = new Date();
    let extra = 0;
    if (task.status === 'in_progress' && task.startedAt) {
      extra = Math.floor((now.getTime() - task.startedAt.getTime()) / 1000);
    }
    const elapsedSeconds = task.elapsedSeconds + Math.max(0, extra);

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.technicianTask.updateMany({
        where: { id, status: task.status },
        data: {
          status: 'completed',
          completedAt: now,
          elapsedSeconds,
          pausedAt: null,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Task was modified by another request',
        });
      }

      await this.events.emit(
        'technician.task.completed',
        {
          taskId: id,
          workOrderId: task.workOrderId,
          elapsedSeconds,
        },
        tx,
      );

      return tx.technicianTask.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    this.realtime.emitTaskChanged({
      branchId: task.workOrder.branchId,
      workOrderId: task.workOrderId,
      taskId: id,
      event: 'technician.task.completed',
      status: 'completed',
    });

    const dto = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: task.workOrder.branchId,
      actorId,
      action: 'technician_task.complete',
      entity: 'TechnicianTask',
      entityId: id,
      after: dto,
    });
    return dto;
  }

  /** Pure helper for unit tests — accumulate elapsed seconds */
  static accumulateElapsed(
    elapsedSeconds: number,
    startedAt: Date | null,
    now: Date,
  ): number {
    if (!startedAt) return elapsedSeconds;
    const extra = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    return elapsedSeconds + Math.max(0, extra);
  }

  private assertCanAccessTask(
    user: AuthUserContext,
    task: {
      assigneeId: string | null;
      workOrder: { technicianId: string | null };
    },
    mode: 'view' | 'mutate' = 'view',
  ) {
    if (this.workOrders.isWorkshopPrivileged(user)) return;
    if (
      mode === 'view' &&
      user.permissions.includes('tasks.view') &&
      !user.roles.includes('technician')
    ) {
      return;
    }
    const ownerId = task.assigneeId ?? task.workOrder.technicianId;
    if (ownerId !== user.sub) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'You can only access tasks assigned to you',
      });
    }
  }

  private assertTaskTransition(
    from: TechnicianTaskStatus,
    to: TechnicianTaskStatus,
  ) {
    if (!(TASK_TRANSITIONS[from] ?? []).includes(to)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Invalid task transition: ${from} → ${to}`,
        details: { from, to },
      });
    }
  }

  private async findOrFail(organizationId: string, id: string) {
    const task = await this.prisma.technicianTask.findFirst({
      where: { id, workOrder: { organizationId } },
      include: this.include(),
    });
    if (!task) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Technician task not found',
      });
    }
    return task;
  }

  private include() {
    return {
      workOrder: {
        include: {
          jobTicket: true,
          visit: {
            include: {
              customer: true,
              vehicle: true,
            },
          },
        },
      },
    } satisfies Prisma.TechnicianTaskInclude;
  }

  private toDto(
    task: Prisma.TechnicianTaskGetPayload<{
      include: ReturnType<TechnicianTasksService['include']>;
    }>,
  ) {
    const blocked =
      task.status === 'blocked' ||
      task.workOrder.visit.status === 'waitingApproval';
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      estimatedMinutes: task.estimatedMinutes,
      elapsedSeconds: task.elapsedSeconds,
      startedAt: task.startedAt,
      pausedAt: task.pausedAt,
      completedAt: task.completedAt,
      blockedReason: task.blockedReason,
      blocked,
      sortOrder: task.sortOrder,
      workOrderId: task.workOrderId,
      workOrderNumber: task.workOrder.number,
      wo: task.workOrder.number,
      ticket: task.workOrder.jobTicket.number,
      visitId: task.workOrder.visitId,
      visitStatus: task.workOrder.visit.status,
      customer: task.workOrder.visit.customer.nameEn,
      customerAr: task.workOrder.visit.customer.nameAr,
      vehicle: `${task.workOrder.visit.vehicle.make} ${task.workOrder.visit.vehicle.model}`,
      plate: task.workOrder.visit.vehicle.plate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}
