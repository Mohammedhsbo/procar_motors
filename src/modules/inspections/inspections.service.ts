import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InspectionResultState,
  Prisma,
  QuotationItemKind,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { VisitStateMachineService } from '../vehicle-visits/visit-state-machine.service';

const DEFAULT_LABOR_RATE_PER_HOUR = 200; // EGP — placeholder until services catalog Phase

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly stateMachine: VisitStateMachineService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  async listByVisit(organizationId: string, visitId: string) {
    await this.assertVisitInOrg(organizationId, visitId);
    const rows = await this.prisma.inspection.findMany({
      where: { visitId },
      orderBy: { createdAt: 'desc' },
      include: this.include(),
    });
    return rows.map((r) => this.toDto(r));
  }

  async getById(organizationId: string, id: string) {
    const inspection = await this.findOrFail(organizationId, id);
    return this.toDto(inspection);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: { visitId: string; templateId?: string; notes?: string },
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

    const existingOpen = await this.prisma.inspection.findFirst({
      where: {
        visitId: visit.id,
        status: { in: ['draft', 'in_progress'] },
      },
    });
    if (existingOpen) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Visit already has an open inspection',
        details: { inspectionId: existingOpen.id },
      });
    }

    const template = dto.templateId
      ? await this.prisma.inspectionTemplate.findFirst({
          where: { id: dto.templateId, organizationId, isActive: true },
          include: { items: true },
        })
      : await this.prisma.inspectionTemplate.findFirst({
          where: {
            organizationId,
            code: 'DEFAULT_10PT',
            isActive: true,
          },
          orderBy: { version: 'desc' },
          include: { items: true },
        });

    if (!template) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'No active inspection template found',
      });
    }

    if (visit.status !== 'waiting' && visit.status !== 'inspection') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot start inspection from visit status ${visit.status}`,
      });
    }

    const inspection = await this.prisma.$transaction(async (tx) => {
      if (visit.status === 'waiting') {
        if (!this.stateMachine.canTransition('waiting', 'inspection')) {
          throw new ConflictException({
            code: ErrorCodes.INVALID_STATUS_TRANSITION,
            message: 'Cannot transition visit to inspection',
          });
        }
        const moved = await tx.vehicleVisit.updateMany({
          where: { id: visit.id, version: visit.version },
          data: {
            status: 'inspection',
            version: { increment: 1 },
            updatedBy: actorId,
            progressPct: 15,
          },
        });
        if (moved.count === 0) {
          throw new ConflictException({
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Visit was modified by another request',
          });
        }
        await this.events.emit(
          'vehicle.status.changed',
          { visitId: visit.id, from: 'waiting', to: 'inspection' },
          tx,
        );
      }

      return tx.inspection.create({
        data: {
          visitId: visit.id,
          templateId: template.id,
          templateVersion: template.version,
          inspectorId: actorId,
          status: 'in_progress',
          startedAt: new Date(),
          notes: dto.notes,
          createdBy: actorId,
        },
        include: this.include(),
      });
    });

    const result = this.toDto(inspection);
    await this.audit.log({
      organizationId,
      branchId: visit.branchId,
      actorId,
      action: 'inspection.create',
      entity: 'Inspection',
      entityId: inspection.id,
      after: result,
    });
    return result;
  }

  async updateResults(
    organizationId: string,
    actorId: string,
    id: string,
    results: Array<{
      templateItemId: string;
      state: InspectionResultState;
      note?: string;
      measurement?: string;
      photoFileIds?: string[];
    }>,
  ) {
    const inspection = await this.findOrFail(organizationId, id);
    if (inspection.status === 'completed') {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Cannot update results on a completed inspection',
      });
    }

    const itemIds = new Set(inspection.template.items.map((i) => i.id));
    for (const r of results) {
      if (!itemIds.has(r.templateItemId)) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Template item ${r.templateItemId} is not part of this inspection template`,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const r of results) {
        const existing = await tx.inspectionResult.findFirst({
          where: {
            inspectionId: id,
            templateItemId: r.templateItemId,
          },
        });
        if (existing) {
          await tx.inspectionResult.update({
            where: { id: existing.id },
            data: {
              state: r.state,
              note: r.note,
              measurement: r.measurement,
              photoFileIds: r.photoFileIds ?? [],
            },
          });
        } else {
          await tx.inspectionResult.create({
            data: {
              inspectionId: id,
              templateItemId: r.templateItemId,
              state: r.state,
              note: r.note,
              measurement: r.measurement,
              photoFileIds: r.photoFileIds ?? [],
            },
          });
        }
      }
      await tx.inspection.update({
        where: { id },
        data: { status: 'in_progress' },
      });
    });

    const updated = await this.findOrFail(organizationId, id);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'inspection.results.update',
      entity: 'Inspection',
      entityId: id,
      after: { resultsCount: updated.results.length },
    });
    return this.toDto(updated);
  }

  async addFinding(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      titleEn: string;
      titleAr: string;
      causeEn?: string;
      causeAr?: string;
      severity?: string;
      recommendedActionEn?: string;
      recommendedActionAr?: string;
      estimatedMinutes?: number;
    },
  ) {
    const inspection = await this.findOrFail(organizationId, id);
    if (inspection.status === 'completed') {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Cannot add findings to a completed inspection',
      });
    }

    const finding = await this.prisma.inspectionFinding.create({
      data: {
        inspectionId: id,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        causeEn: dto.causeEn,
        causeAr: dto.causeAr,
        severity: dto.severity,
        recommendedActionEn: dto.recommendedActionEn,
        recommendedActionAr: dto.recommendedActionAr,
        estimatedMinutes: dto.estimatedMinutes,
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: 'inspection.finding.create',
      entity: 'InspectionFinding',
      entityId: finding.id,
      after: finding,
    });

    return {
      id: finding.id,
      titleEn: finding.titleEn,
      titleAr: finding.titleAr,
      causeEn: finding.causeEn,
      causeAr: finding.causeAr,
      severity: finding.severity,
      recommendedActionEn: finding.recommendedActionEn,
      recommendedActionAr: finding.recommendedActionAr,
      estimatedMinutes: finding.estimatedMinutes,
      // FE diagnosedProblems shape aliases
      en: finding.titleEn,
      ar: finding.titleAr,
      cause: finding.causeEn,
      causeArLabel: finding.causeAr,
      action: finding.recommendedActionEn,
      actionAr: finding.recommendedActionAr,
      time:
        finding.estimatedMinutes != null
          ? this.formatMinutes(finding.estimatedMinutes)
          : null,
    };
  }

  async complete(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: {
      notes?: string;
      recommendedItems?: Array<{
        kind: QuotationItemKind;
        nameEn: string;
        nameAr: string;
        qty: number;
        unitPrice: number;
      }>;
    },
  ) {
    const inspection = await this.findOrFail(organizationId, id);
    if (inspection.status === 'completed') {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Inspection already completed',
      });
    }

    const templateItemIds = inspection.template.items.map((i) => i.id);
    const resultItemIds = new Set(
      inspection.results.map((r) => r.templateItemId),
    );
    const missing = templateItemIds.filter((tid) => !resultItemIds.has(tid));
    if (missing.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'All checklist items must have results before completion',
        details: { missingTemplateItemIds: missing },
      });
    }

    const visit = await this.prisma.vehicleVisit.findFirstOrThrow({
      where: { id: inspection.visitId },
      include: { jobTicket: true },
    });

    if (!this.stateMachine.canTransition(visit.status, 'waitingApproval')) {
      // Allow complete if already waitingApproval (idempotent-ish) — else error
      if (visit.status !== 'waitingApproval') {
        throw new ConflictException({
          code: ErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot move visit from ${visit.status} to waitingApproval`,
        });
      }
    }

    const taxRate = await this.getTaxRate(organizationId);
    const laborRate = DEFAULT_LABOR_RATE_PER_HOUR;

    const quoteItems: Array<{
      kind: QuotationItemKind;
      nameEn: string;
      nameAr: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
      sortOrder: number;
    }> = [];

    let sort = 0;
    for (const f of inspection.findings) {
      const minutes = f.estimatedMinutes ?? 60;
      const hours = minutes / 60;
      const unitPrice = Math.round(hours * laborRate * 100) / 100;
      quoteItems.push({
        kind: 'labor',
        nameEn: f.recommendedActionEn || f.titleEn,
        nameAr: f.recommendedActionAr || f.titleAr,
        qty: 1,
        unitPrice,
        lineTotal: unitPrice,
        sortOrder: sort++,
      });
    }

    for (const item of dto?.recommendedItems ?? []) {
      const lineTotal =
        Math.round(Number(item.qty) * Number(item.unitPrice) * 100) / 100;
      quoteItems.push({
        kind: item.kind,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal,
        sortOrder: sort++,
      });
    }

    // Always include diagnostics line if no items yet
    if (quoteItems.length === 0) {
      quoteItems.push({
        kind: 'diagnostics',
        nameEn: 'Inspection diagnostics',
        nameAr: 'تشخيص الفحص',
        qty: 1,
        unitPrice: 300,
        lineTotal: 300,
        sortOrder: 0,
      });
    }

    const subtotal =
      Math.round(quoteItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    const discount = 0;
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * (taxRate / 100) * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;
    const estimatedMinutes = inspection.findings.reduce(
      (s, f) => s + (f.estimatedMinutes ?? 0),
      0,
    );

    const completed = await this.prisma.$transaction(async (tx) => {
      const qNumber = await this.sequences.nextInTx(tx, organizationId, 'Q');

      const quotation = await tx.quotation.create({
        data: {
          organizationId,
          branchId: visit.branchId,
          visitId: visit.id,
          jobTicketId: visit.jobTicket?.id,
          customerId: visit.customerId,
          vehicleId: visit.vehicleId,
          number: qNumber,
          version: 1,
          status: 'draft',
          subtotal,
          discount,
          tax,
          total,
          estimatedMinutes: estimatedMinutes || null,
          createdBy: actorId,
          items: {
            create: quoteItems.map((i) => ({
              kind: i.kind,
              nameEn: i.nameEn,
              nameAr: i.nameAr,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
              sortOrder: i.sortOrder,
            })),
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      const insp = await tx.inspection.update({
        where: { id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          notes: dto?.notes ?? inspection.notes,
          estimatedTotal: total,
        },
        include: this.include(),
      });

      if (visit.status !== 'waitingApproval') {
        const moved = await tx.vehicleVisit.updateMany({
          where: { id: visit.id, version: visit.version },
          data: {
            status: 'waitingApproval',
            version: { increment: 1 },
            updatedBy: actorId,
            progressPct: 40,
          },
        });
        if (moved.count === 0) {
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
            to: 'waitingApproval',
          },
          tx,
        );
      }

      await this.events.emit(
        'inspection.completed',
        {
          inspectionId: id,
          visitId: visit.id,
          quotationId: quotation.id,
          quotationNumber: quotation.number,
        },
        tx,
      );

      return { insp, quotation };
    });

    const inspectionDto = this.toDto(completed.insp);
    const quotationDto = {
      id: completed.quotation.id,
      number: completed.quotation.number,
      version: completed.quotation.version,
      status: completed.quotation.status,
      subtotal: Number(completed.quotation.subtotal),
      discount: Number(completed.quotation.discount),
      tax: Number(completed.quotation.tax),
      total: Number(completed.quotation.total),
      estimatedMinutes: completed.quotation.estimatedMinutes,
      items: completed.quotation.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        sortOrder: i.sortOrder,
      })),
    };

    await this.audit.log({
      organizationId,
      branchId: visit.branchId,
      actorId,
      action: 'inspection.complete',
      entity: 'Inspection',
      entityId: id,
      after: { inspection: inspectionDto, quotation: quotationDto },
    });

    return {
      inspection: inspectionDto,
      quotation: quotationDto,
      visitStatus: 'waitingApproval' as const,
    };
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

  private async assertVisitInOrg(organizationId: string, visitId: string) {
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id: visitId, organizationId, deletedAt: null },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    return visit;
  }

  private async findOrFail(organizationId: string, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, visit: { organizationId } },
      include: this.include(),
    });
    if (!inspection) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    return inspection;
  }

  private include() {
    return {
      template: {
        include: { items: { orderBy: { sortOrder: 'asc' as const } } },
      },
      results: { include: { templateItem: true } },
      findings: true,
      visit: {
        select: {
          id: true,
          status: true,
          branchId: true,
          customerId: true,
          vehicleId: true,
          organizationId: true,
        },
      },
    } satisfies Prisma.InspectionInclude;
  }

  private toDto(
    inspection: Prisma.InspectionGetPayload<{
      include: ReturnType<InspectionsService['include']>;
    }>,
  ) {
    const checklist = inspection.template.items.map((item) => {
      const result = inspection.results.find(
        (r) => r.templateItemId === item.id,
      );
      return {
        templateItemId: item.id,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        // FE inspectionChecklist aliases
        en: item.nameEn,
        ar: item.nameAr,
        state: result?.state ?? null,
        note: result?.note ?? '',
        noteAr: result?.note ?? '',
        measurement: result?.measurement ?? null,
        photoFileIds: result?.photoFileIds ?? [],
        resultId: result?.id ?? null,
      };
    });

    const findings = inspection.findings.map((f) => ({
      id: f.id,
      titleEn: f.titleEn,
      titleAr: f.titleAr,
      causeEn: f.causeEn,
      causeAr: f.causeAr,
      severity: f.severity,
      recommendedActionEn: f.recommendedActionEn,
      recommendedActionAr: f.recommendedActionAr,
      estimatedMinutes: f.estimatedMinutes,
      en: f.titleEn,
      ar: f.titleAr,
      cause: f.causeEn,
      action: f.recommendedActionEn,
      actionAr: f.recommendedActionAr,
      time:
        f.estimatedMinutes != null
          ? this.formatMinutes(f.estimatedMinutes)
          : null,
    }));

    return {
      id: inspection.id,
      visitId: inspection.visitId,
      visitStatus: inspection.visit.status,
      templateId: inspection.templateId,
      templateVersion: inspection.templateVersion,
      templateCode: inspection.template.code,
      templateNameEn: inspection.template.nameEn,
      templateNameAr: inspection.template.nameAr,
      inspectorId: inspection.inspectorId,
      status: inspection.status,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      notes: inspection.notes,
      estimatedTotal:
        inspection.estimatedTotal != null
          ? Number(inspection.estimatedTotal)
          : null,
      checklist,
      findings,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,
    };
  }

  private formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
}
