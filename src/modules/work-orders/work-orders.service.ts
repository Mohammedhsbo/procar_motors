import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Priority, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import type { AuthUserContext } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { VisitStateMachineService } from '../vehicle-visits/visit-state-machine.service';
import { WorkOrderStateMachineService } from './work-order-state-machine.service';
import { QuotationCalculatorService } from '../quotations/quotation-calculator.service';
import { WorkshopRealtimeService } from '../../infrastructure/realtime/workshop-realtime.service';
import { DEFAULT_QC_CHECKLIST } from '../../common/constants/qc-checklist';

const DEFAULT_QC_ITEMS = DEFAULT_QC_CHECKLIST;

type Tx = Prisma.TransactionClient;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly woSm: WorkOrderStateMachineService,
    private readonly visitSm: VisitStateMachineService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly quoteCalculator: QuotationCalculatorService,
    private readonly realtime: WorkshopRealtimeService,
  ) {}

  /** Managers / admins with assign permission see all; technicians only own. */
  isWorkshopPrivileged(user: AuthUserContext): boolean {
    if (
      user.roles.some((r) =>
        ['super_admin', 'workshop_manager', 'branch_admin'].includes(r),
      )
    ) {
      return true;
    }
    return user.permissions.includes('work_orders.assign');
  }

  assertCanAccessWorkOrder(
    user: AuthUserContext,
    wo: { technicianId: string | null },
    mode: 'view' | 'mutate' = 'mutate',
  ) {
    if (this.isWorkshopPrivileged(user)) return;
    // Advisors with view-only may read any branch WO
    if (
      mode === 'view' &&
      user.permissions.includes('work_orders.view') &&
      !user.roles.includes('technician')
    ) {
      return;
    }
    if (wo.technicianId !== user.sub) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'You can only access work orders assigned to you',
      });
    }
  }

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: WorkOrderStatus;
      visitId?: string;
      technicianId?: string;
    },
    user?: AuthUserContext,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const ownOnly =
      user &&
      !this.isWorkshopPrivileged(user) &&
      user.roles.includes('technician');
    const where: Prisma.WorkOrderWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.visitId ? { visitId: query.visitId } : {}),
      ...(ownOnly
        ? { technicianId: user.sub }
        : query.technicianId
          ? { technicianId: query.technicianId }
          : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.workOrder.count({ where }),
      this.prisma.workOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.include(),
      }),
    ]);

    return {
      data: await Promise.all(rows.map((w) => this.toDto(w))),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string, user?: AuthUserContext) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'view');
    return this.toDto(wo);
  }

  /** Called from quotation approve (same transaction) */
  async createFromApprovedQuotationInTx(
    tx: Tx,
    params: {
      organizationId: string;
      actorId: string;
      quotation: {
        id: string;
        visitId: string;
        jobTicketId: string | null;
        branchId: string;
        estimatedMinutes: number | null;
        priority?: Priority;
        items: Array<{
          kind: string;
          nameEn: string;
          nameAr: string;
        }>;
      };
    },
  ) {
    const visit = await tx.vehicleVisit.findFirstOrThrow({
      where: { id: params.quotation.visitId },
      include: { jobTicket: true },
    });
    const existing = await tx.workOrder.findFirst({
      where: {
        visitId: params.quotation.visitId,
        status: { notIn: ['cancelled'] },
      },
      include: { tasks: true },
    });
    if (existing) {
      // Keep WO paused after additional-issue re-approval — do not auto-resume.
      // Only unblock tasks so work can resume after an explicit start.
      if (existing.status === 'paused' || existing.status === 'draft') {
        await tx.technicianTask.updateMany({
          where: { workOrderId: existing.id, status: 'blocked' },
          data: {
            status: 'assigned',
            blockedReason: null,
            pausedAt: null,
          },
        });
      }
      return tx.workOrder.findFirstOrThrow({
        where: { id: existing.id },
        include: { tasks: true },
      });
    }
    const jobTicketId =
      params.quotation.jobTicketId ?? visit.jobTicket?.id ?? null;
    if (!jobTicketId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Visit has no job ticket for work order creation',
      });
    }

    const number = await this.sequences.nextInTx(
      tx,
      params.organizationId,
      'WO',
    );

    const laborItems = params.quotation.items.filter((i) =>
      ['labor', 'service', 'diagnostics'].includes(i.kind),
    );
    const taskSources =
      laborItems.length > 0
        ? laborItems
        : [
            {
              kind: 'labor',
              nameEn: 'Repair work',
              nameAr: 'أعمال الإصلاح',
            },
          ];

    const wo = await tx.workOrder.create({
      data: {
        organizationId: params.organizationId,
        branchId: params.quotation.branchId,
        visitId: params.quotation.visitId,
        jobTicketId,
        number,
        status: 'draft',
        priority: params.quotation.priority ?? visit.priority,
        estimatedMinutes: params.quotation.estimatedMinutes,
        progressPct: 0,
        createdBy: params.actorId,
        tasks: {
          create: taskSources.map((item, idx) => ({
            title: item.nameEn,
            status: 'pending',
            priority: params.quotation.priority ?? visit.priority,
            estimatedMinutes: null,
            sortOrder: idx,
          })),
        },
      },
      include: { tasks: true },
    });

    await this.events.emit(
      'workorder.created',
      {
        workOrderId: wo.id,
        number: wo.number,
        visitId: wo.visitId,
        quotationId: params.quotation.id,
        taskCount: wo.tasks.length,
      },
      tx,
    );

    return wo;
  }

  async create(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      visitId: string;
      priority?: Priority;
      estimatedMinutes?: number;
      tasks?: Array<{ title: string; estimatedMinutes?: number }>;
    },
  ) {
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id: dto.visitId, organizationId, deletedAt: null },
      include: { jobTicket: true },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    if (visit.branchId !== branchId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Visit does not belong to the active branch',
      });
    }
    if (!visit.jobTicket) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Visit has no job ticket',
      });
    }
    if (visit.status === 'waitingApproval') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Cannot create work order while visit is waitingApproval',
      });
    }

    const approved = await this.prisma.quotation.findFirst({
      where: { visitId: visit.id, status: 'approved' },
      orderBy: { version: 'desc' },
    });
    if (!approved && !['readyForRepair', 'inProgress'].includes(visit.status)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          'Visit needs an approved quotation before creating a work order',
      });
    }

    const wo = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'WO');
      const tasks = dto.tasks?.length
        ? dto.tasks
        : [{ title: 'Repair work', estimatedMinutes: dto.estimatedMinutes }];

      const created = await tx.workOrder.create({
        data: {
          organizationId,
          branchId,
          visitId: visit.id,
          jobTicketId: visit.jobTicket!.id,
          number,
          status: 'draft',
          priority: dto.priority ?? visit.priority,
          estimatedMinutes: dto.estimatedMinutes,
          createdBy: actorId,
          tasks: {
            create: tasks.map((t, idx) => ({
              title: t.title,
              estimatedMinutes: t.estimatedMinutes,
              status: 'pending',
              priority: dto.priority ?? visit.priority,
              sortOrder: idx,
            })),
          },
        },
        include: this.include(),
      });

      await this.events.emit(
        'workorder.created',
        {
          workOrderId: created.id,
          number: created.number,
          visitId: created.visitId,
        },
        tx,
      );
      return created;
    });

    const result = await this.toDto(wo);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'work_order.create',
      entity: 'WorkOrder',
      entityId: wo.id,
      after: result,
    });
    return result;
  }

  async assign(
    organizationId: string,
    actorId: string,
    id: string,
    dto: { technicianId: string; bayId?: string },
  ) {
    const wo = await this.findOrFail(organizationId, id);
    this.assertWoTransition(wo.status, 'assigned');

    const tech = await this.prisma.user.findFirst({
      where: {
        id: dto.technicianId,
        organizationId,
        userType: 'staff',
        deletedAt: null,
        status: 'active',
      },
    });
    if (!tech) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Technician user not found',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.workOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          status: 'assigned',
          technicianId: dto.technicianId,
          bayId: dto.bayId,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }

      await tx.technicianTask.updateMany({
        where: { workOrderId: id, status: { in: ['pending', 'assigned'] } },
        data: { assigneeId: dto.technicianId, status: 'assigned' },
      });

      await this.events.emit(
        'workorder.assigned',
        {
          workOrderId: id,
          technicianId: dto.technicianId,
          number: wo.number,
        },
        tx,
      );
      await this.events.emit(
        'workorder.status.changed',
        { workOrderId: id, from: wo.status, to: 'assigned' },
        tx,
      );

      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.assign',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    return result;
  }

  async start(
    organizationId: string,
    actorId: string,
    id: string,
    user?: AuthUserContext,
  ) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'mutate');
    if (wo.visit.status === 'waitingApproval') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Cannot start work while visit is waitingApproval',
      });
    }
    if (!wo.technicianId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Assign a technician before starting the work order',
      });
    }

    const fromStatus = wo.status;
    const toStatus: WorkOrderStatus = 'in_progress';
    if (
      fromStatus !== 'assigned' &&
      fromStatus !== 'paused' &&
      fromStatus !== 'waiting_parts'
    ) {
      this.assertWoTransition(fromStatus, toStatus);
    } else if (!this.woSm.canTransition(fromStatus, toStatus)) {
      this.assertWoTransition(fromStatus, toStatus);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.workOrder.updateMany({
        where: { id, status: fromStatus },
        data: {
          status: toStatus,
          startedAt: wo.startedAt ?? new Date(),
          progressPct: Math.max(wo.progressPct, 10),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }

      await tx.technicianTask.updateMany({
        where: {
          workOrderId: id,
          status: { in: ['assigned', 'paused', 'pending'] },
        },
        data: {
          status: 'in_progress',
          startedAt: new Date(),
          pausedAt: null,
          assigneeId: wo.technicianId,
        },
      });

      if (
        wo.visit.status === 'readyForRepair' &&
        this.visitSm.canTransition('readyForRepair', 'inProgress')
      ) {
        const visitMoved = await tx.vehicleVisit.updateMany({
          where: { id: wo.visitId, version: wo.visit.version },
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
        await this.events.emit(
          'vehicle.status.changed',
          {
            visitId: wo.visitId,
            from: 'readyForRepair',
            to: 'inProgress',
          },
          tx,
        );
      }

      await this.events.emit(
        'workorder.status.changed',
        { workOrderId: id, from: fromStatus, to: toStatus },
        tx,
      );

      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    if (wo.visit.status === 'readyForRepair') {
      this.realtime.emitVisitStatusChanged({
        branchId: wo.branchId,
        visitId: wo.visitId,
        from: 'readyForRepair',
        to: 'inProgress',
      });
    }

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.start',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    return result;
  }

  async pause(
    organizationId: string,
    actorId: string,
    id: string,
    user?: AuthUserContext,
  ) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'mutate');
    this.assertWoTransition(wo.status, 'paused');

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const tasks = await tx.technicianTask.findMany({
        where: { workOrderId: id, status: 'in_progress' },
      });
      for (const task of tasks) {
        let extra = 0;
        if (task.startedAt) {
          extra = Math.floor((now.getTime() - task.startedAt.getTime()) / 1000);
        }
        await tx.technicianTask.update({
          where: { id: task.id },
          data: {
            status: 'paused',
            pausedAt: now,
            elapsedSeconds: task.elapsedSeconds + Math.max(0, extra),
          },
        });
      }

      const moved = await tx.workOrder.updateMany({
        where: { id, status: 'in_progress' },
        data: { status: 'paused' },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }

      await this.events.emit(
        'workorder.status.changed',
        { workOrderId: id, from: 'in_progress', to: 'paused' },
        tx,
      );

      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.pause',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    return result;
  }

  async complete(
    organizationId: string,
    actorId: string,
    id: string,
    user?: AuthUserContext,
  ) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'mutate');
    if (!['in_progress', 'paused'].includes(wo.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot complete work order from status ${wo.status}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const openTasks = await tx.technicianTask.findMany({
        where: {
          workOrderId: id,
          status: { notIn: ['completed', 'blocked'] },
        },
      });

      for (const task of openTasks) {
        let extra = 0;
        if (task.status === 'in_progress' && task.startedAt) {
          extra = Math.floor((now.getTime() - task.startedAt.getTime()) / 1000);
        }
        await tx.technicianTask.update({
          where: { id: task.id },
          data: {
            status: 'completed',
            completedAt: now,
            elapsedSeconds: task.elapsedSeconds + Math.max(0, extra),
            pausedAt: null,
          },
        });
      }

      const allTasks = await tx.technicianTask.findMany({
        where: { workOrderId: id },
      });
      const totalElapsed = allTasks.reduce((s, t) => s + t.elapsedSeconds, 0);

      const moved = await tx.workOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          progressPct: 100,
          actualMinutes: Math.ceil(totalElapsed / 60) || wo.estimatedMinutes,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }

      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.complete',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    return result;
  }

  async sendToQc(
    organizationId: string,
    actorId: string,
    id: string,
    user?: AuthUserContext,
  ) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'mutate');
    if (!['in_progress', 'paused'].includes(wo.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot send to QC from status ${wo.status}`,
      });
    }

    const incomplete = wo.tasks.filter((t) => t.status !== 'completed');
    if (incomplete.length) {
      throw new ConflictException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Cannot send to QC until all tasks are completed',
        details: {
          incompleteTaskIds: incomplete.map((t) => t.id),
          incompleteCount: incomplete.length,
        },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.workOrder.updateMany({
        where: { id, status: { in: ['in_progress', 'paused'] } },
        data: {
          status: 'qc',
          progressPct: 100,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }

      const existingQc = await tx.qualityCheck.findFirst({
        where: { workOrderId: id, status: 'pending' },
      });
      if (!existingQc) {
        await tx.qualityCheck.create({
          data: {
            visitId: wo.visitId,
            workOrderId: id,
            status: 'pending',
            items: {
              create: DEFAULT_QC_ITEMS.map((item) => ({
                labelEn: item.labelEn,
                labelAr: item.labelAr,
              })),
            },
          },
        });
      }

      const visit = await tx.vehicleVisit.findFirstOrThrow({
        where: { id: wo.visitId },
      });
      if (
        visit.status !== 'qualityCheck' &&
        this.visitSm.canTransition(visit.status, 'qualityCheck')
      ) {
        const visitMoved = await tx.vehicleVisit.updateMany({
          where: { id: visit.id, version: visit.version },
          data: {
            status: 'qualityCheck',
            version: { increment: 1 },
            updatedBy: actorId,
            progressPct: 90,
          },
        });
        if (visitMoved.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Visit was modified by another request',
          });
        }
        await this.events.emit(
          'vehicle.status.changed',
          {
            visitId: visit.id,
            from: visit.status,
            to: 'qualityCheck',
          },
          tx,
        );
      }

      await this.events.emit(
        'workorder.status.changed',
        { workOrderId: id, from: wo.status, to: 'qc' },
        tx,
      );

      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.send_to_qc',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    this.realtime.emitVisitStatusChanged({
      branchId: wo.branchId,
      visitId: wo.visitId,
      from: wo.visit.status,
      to: 'qualityCheck',
    });
    return {
      ...result,
      visitStatus: 'qualityCheck' as const,
    };
  }

  /**
   * Additional issue during repair:
   * pause WO → draft quotation (advisor reviews/sends) → block open tasks.
   * Visit stays until advisor sends the quote → waitingApproval.
   */
  async additionalIssue(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      titleEn: string;
      titleAr: string;
      causeEn?: string;
      causeAr?: string;
      unitPrice?: number;
      estimatedMinutes?: number;
    },
    user?: AuthUserContext,
  ) {
    const wo = await this.findOrFail(organizationId, id);
    if (user) this.assertCanAccessWorkOrder(user, wo, 'mutate');
    if (
      !['assigned', 'in_progress', 'paused', 'waiting_parts'].includes(
        wo.status,
      )
    ) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot report additional issue from work order status ${wo.status}`,
      });
    }

    const unitPrice = dto.unitPrice ?? 0;
    const taxRate = await this.getTaxRate(organizationId);
    const totals = this.quoteCalculator.calculate([{ qty: 1, unitPrice }], {
      taxRatePct: taxRate,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (wo.status === 'in_progress') {
        const paused = await tx.workOrder.updateMany({
          where: { id, status: 'in_progress' },
          data: { status: 'paused' },
        });
        if (paused.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Work order was modified by another request',
          });
        }
        await this.events.emit(
          'workorder.status.changed',
          {
            workOrderId: id,
            from: 'in_progress',
            to: 'paused',
            reason: 'additional_issue',
          },
          tx,
        );
      } else if (wo.status !== 'paused') {
        // assigned / waiting_parts → pause for advisor review
        const paused = await tx.workOrder.updateMany({
          where: { id, status: wo.status },
          data: { status: 'paused' },
        });
        if (paused.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Work order was modified by another request',
          });
        }
        await this.events.emit(
          'workorder.status.changed',
          {
            workOrderId: id,
            from: wo.status,
            to: 'paused',
            reason: 'additional_issue',
          },
          tx,
        );
      }

      await tx.technicianTask.updateMany({
        where: {
          workOrderId: id,
          status: { in: ['pending', 'assigned', 'in_progress', 'paused'] },
        },
        data: {
          status: 'blocked',
          blockedReason: 'Additional issue — awaiting quotation approval',
          pausedAt: new Date(),
        },
      });

      const number = await this.sequences.nextInTx(tx, organizationId, 'Q');

      const quotation = await tx.quotation.create({
        data: {
          organizationId,
          branchId: wo.branchId,
          visitId: wo.visitId,
          jobTicketId: wo.jobTicketId,
          customerId: wo.visit.customerId,
          vehicleId: wo.visit.vehicleId,
          number,
          version: 1,
          status: 'draft',
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          estimatedMinutes: dto.estimatedMinutes,
          createdBy: actorId,
          items: {
            create: [
              {
                kind: 'labor',
                nameEn: dto.titleEn,
                nameAr: dto.titleAr,
                qty: 1,
                unitPrice,
                lineTotal: totals.lines[0].lineTotal,
                sortOrder: 0,
              },
            ],
          },
        },
      });

      await this.events.emit(
        'workorder.additional_issue',
        {
          quotationId: quotation.id,
          visitId: wo.visitId,
          workOrderId: id,
          number: quotation.number,
          titleEn: dto.titleEn,
          causeEn: dto.causeEn ?? null,
          status: 'draft',
        },
        tx,
      );

      const workOrder = await tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
      return { workOrder, quotation };
    });

    const woDto = await this.toDto(updated.workOrder);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.additional_issue',
      entity: 'WorkOrder',
      entityId: id,
      after: {
        workOrderId: id,
        quotationId: updated.quotation.id,
        quotationStatus: 'draft',
        visitStatus: wo.visit.status,
      },
    });

    return {
      workOrder: woDto,
      quotation: {
        id: updated.quotation.id,
        number: updated.quotation.number,
        status: updated.quotation.status,
        total: Number(updated.quotation.total),
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        causeEn: dto.causeEn ?? null,
        causeAr: dto.causeAr ?? null,
      },
      visitStatus: wo.visit.status,
    };
  }

  async cancel(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    const wo = await this.findOrFail(organizationId, id);
    this.assertWoTransition(wo.status, 'cancelled');

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.workOrder.updateMany({
        where: { id, status: wo.status },
        data: { status: 'cancelled' },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Work order was modified by another request',
        });
      }
      await tx.technicianTask.updateMany({
        where: {
          workOrderId: id,
          status: { notIn: ['completed'] },
        },
        data: {
          status: 'blocked',
          blockedReason: dto?.reason ?? 'Work order cancelled',
        },
      });
      await this.events.emit(
        'workorder.status.changed',
        {
          workOrderId: id,
          from: wo.status,
          to: 'cancelled',
          reason: dto?.reason ?? null,
        },
        tx,
      );
      return tx.workOrder.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = await this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: wo.branchId,
      actorId,
      action: 'work_order.cancel',
      entity: 'WorkOrder',
      entityId: id,
      after: result,
    });
    return result;
  }

  private async getTaxRate(organizationId: string): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key: 'default_tax_rate',
        },
      },
    });
    const rate = Number(setting?.value ?? 14);
    return Number.isFinite(rate) ? rate : 14;
  }

  private assertWoTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
    if (!this.woSm.canTransition(from, to)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Invalid work order transition: ${from} → ${to}`,
        details: { from, to },
      });
    }
  }

  private async findOrFail(organizationId: string, id: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!wo) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Work order not found',
      });
    }
    return wo;
  }

  private include() {
    return {
      tasks: { orderBy: { sortOrder: 'asc' as const } },
      qualityChecks: { orderBy: { createdAt: 'desc' as const }, take: 1 },
      jobTicket: true,
      visit: {
        include: {
          customer: true,
          vehicle: true,
          branch: true,
        },
      },
    } satisfies Prisma.WorkOrderInclude;
  }

  private async toDto(
    wo: Prisma.WorkOrderGetPayload<{
      include: ReturnType<WorkOrdersService['include']>;
    }>,
  ) {
    const peopleIds = [wo.technicianId, wo.visit.advisorId].filter(
      (id): id is string => Boolean(id),
    );
    const people =
      peopleIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: peopleIds } },
            select: {
              id: true,
              employee: { select: { nameEn: true, nameAr: true } },
            },
          })
        : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const tech = wo.technicianId ? byId.get(wo.technicianId) : undefined;
    const advisor = wo.visit.advisorId
      ? byId.get(wo.visit.advisorId)
      : undefined;

    const tasksCompleted = wo.tasks.filter(
      (t) => t.status === 'completed',
    ).length;
    return {
      id: wo.id,
      number: wo.number,
      status: wo.status,
      priority: wo.priority,
      progress: wo.progressPct,
      progressPct: wo.progressPct,
      technicianId: wo.technicianId,
      bayId: wo.bayId,
      estimatedMinutes: wo.estimatedMinutes,
      actualMinutes: wo.actualMinutes,
      startedAt: wo.startedAt,
      completedAt: wo.completedAt,
      visitId: wo.visitId,
      jobTicketId: wo.jobTicketId,
      branchId: wo.branchId,
      ticket: wo.jobTicket.number,
      wo: wo.number,
      customer: wo.visit.customer.nameEn,
      customerAr: wo.visit.customer.nameAr,
      customerNameEn: wo.visit.customer.nameEn,
      customerNameAr: wo.visit.customer.nameAr,
      phone: wo.visit.customer.phone,
      vehicle: `${wo.visit.vehicle.make} ${wo.visit.vehicle.model}`,
      plate: wo.visit.vehicle.plate,
      year: wo.visit.vehicle.year,
      branch: wo.visit.branch.code,
      visitStatus: wo.visit.status,
      advisor: advisor?.employee?.nameEn ?? null,
      advisorAr: advisor?.employee?.nameAr ?? null,
      technician: tech?.employee?.nameEn ?? null,
      technicianAr: tech?.employee?.nameAr ?? null,
      tasks: wo.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assigneeId,
        estimatedMinutes: t.estimatedMinutes,
        elapsedSeconds: t.elapsedSeconds,
        startedAt: t.startedAt,
        pausedAt: t.pausedAt,
        completedAt: t.completedAt,
        sortOrder: t.sortOrder,
      })),
      tasksCompleted,
      tasksTotal: wo.tasks.length,
      qualityCheckId: wo.qualityChecks[0]?.id ?? null,
      createdAt: wo.createdAt,
      updatedAt: wo.updatedAt,
    };
  }
}
