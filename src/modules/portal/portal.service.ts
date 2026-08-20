import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { QuotationsService } from '../quotations/quotations.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import type { AuthUserContext } from '../auth/auth.types';

/** Portal UI stages (frontend portal.tsx). */
export const PORTAL_STAGES = [
  'received',
  'inspection',
  'quotation',
  'inProgress',
  'qualityCheck',
  'readyForDelivery',
] as const;

export type PortalStage = (typeof PORTAL_STAGES)[number];

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotations: QuotationsService,
    private readonly audit: AuditService,
  ) {}

  assertCustomer(user: AuthUserContext): string {
    if (user.userType !== 'customer' || !user.customerId) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Customer portal access required',
      });
    }
    return user.customerId;
  }

  async listVehicles(user: AuthUserContext) {
    const customerId = this.assertCustomer(user);
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        organizationId: user.orgId,
        customerId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        plate: true,
        make: true,
        model: true,
        year: true,
        vin: true,
        color: true,
      },
    });
    return { items: vehicles };
  }

  async visitStatus(user: AuthUserContext, visitId: string) {
    const customerId = this.assertCustomer(user);
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: {
        id: visitId,
        organizationId: user.orgId,
        customerId,
        deletedAt: null,
      },
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            make: true,
            model: true,
            year: true,
          },
        },
        jobTicket: { select: { number: true } },
      },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }

    const stage = mapVisitToPortalStage(visit.status);
    const stageIndex = PORTAL_STAGES.indexOf(stage);
    const timeline = PORTAL_STAGES.map((s, i) => ({
      stage: s,
      labelEn: portalStageLabelEn(s),
      labelAr: portalStageLabelAr(s),
      reached: i <= stageIndex,
      current: i === stageIndex,
    }));

    return {
      visitId: visit.id,
      status: visit.status,
      portalStage: stage,
      progressPct: visit.progressPct,
      ticketNumber: visit.jobTicket?.number ?? null,
      vehicle: visit.vehicle,
      checkedInAt: visit.checkedInAt,
      expectedDeliveryAt: visit.expectedDeliveryAt,
      timeline,
    };
  }

  async getQuotation(user: AuthUserContext, quotationId: string) {
    const customerId = this.assertCustomer(user);
    const quote = await this.prisma.quotation.findFirst({
      where: {
        id: quotationId,
        organizationId: user.orgId,
        customerId,
        status: {
          in: ['sent', 'pending', 'approved', 'rejected', 'expired'],
        },
      },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        visit: {
          select: {
            id: true,
            status: true,
            vehicle: { select: { plate: true, make: true, model: true } },
          },
        },
      },
    });
    if (!quote) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quotation not found',
      });
    }

    return {
      id: quote.id,
      number: quote.number,
      status: quote.status,
      visitId: quote.visitId,
      validUntil: quote.validUntil,
      subtotal: Number(quote.subtotal),
      discount: Number(quote.discount),
      tax: Number(quote.tax),
      total: Number(quote.total),
      visit: quote.visit,
      items: quote.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
    };
  }

  async approveQuotation(
    user: AuthUserContext,
    quotationId: string,
    comment?: string,
  ) {
    const customerId = this.assertCustomer(user);
    await this.assertOwnsQuotation(user.orgId, customerId, quotationId);
    return this.quotations.approve(user.orgId, user.sub, quotationId, {
      comment,
      actorType: 'customer',
    });
  }

  async rejectQuotation(
    user: AuthUserContext,
    quotationId: string,
    comment?: string,
  ) {
    const customerId = this.assertCustomer(user);
    await this.assertOwnsQuotation(user.orgId, customerId, quotationId);
    return this.quotations.reject(user.orgId, user.sub, quotationId, {
      comment,
      actorType: 'customer',
    });
  }

  async listInvoices(user: AuthUserContext) {
    const customerId = this.assertCustomer(user);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: user.orgId,
        customerId,
        status: { in: ['issued', 'partial', 'paid', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        amountPaid: true,
        issuedAt: true,
        visitId: true,
      },
    });
    return {
      items: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        total: Number(inv.total),
        amountPaid: Number(inv.amountPaid),
        outstanding: Number(inv.total) - Number(inv.amountPaid),
        issuedAt: inv.issuedAt,
        visitId: inv.visitId,
      })),
    };
  }

  async serviceHistory(user: AuthUserContext) {
    const customerId = this.assertCustomer(user);
    const visits = await this.prisma.vehicleVisit.findMany({
      where: {
        organizationId: user.orgId,
        customerId,
        deletedAt: null,
      },
      orderBy: { checkedInAt: 'desc' },
      take: 50,
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            make: true,
            model: true,
            year: true,
          },
        },
        jobTicket: { select: { number: true } },
      },
    });

    return {
      items: visits.map((v) => ({
        visitId: v.id,
        status: v.status,
        portalStage: mapVisitToPortalStage(v.status),
        ticketNumber: v.jobTicket?.number ?? null,
        complaint: v.complaint,
        checkedInAt: v.checkedInAt,
        expectedDeliveryAt: v.expectedDeliveryAt,
        completedAt: v.completedAt,
        deliveredAt: v.deliveredAt,
        /** True once the workshop is finished with the vehicle. */
        done: v.deliveredAt !== null || v.completedAt !== null,
        vehicle: v.vehicle,
      })),
    };
  }

  async submitFeedback(
    user: AuthUserContext,
    dto: { visitId?: string; rating?: number; comment: string },
  ) {
    const customerId = this.assertCustomer(user);
    if (dto.visitId) {
      const visit = await this.prisma.vehicleVisit.findFirst({
        where: {
          id: dto.visitId,
          organizationId: user.orgId,
          customerId,
          deletedAt: null,
        },
      });
      if (!visit) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Visit not found',
        });
      }
    }

    const row = await this.prisma.portalFeedback.create({
      data: {
        organizationId: user.orgId,
        customerId,
        visitId: dto.visitId,
        rating: dto.rating,
        comment: dto.comment.trim(),
      },
    });

    await this.audit.log({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'portal.feedback.created',
      entity: 'PortalFeedback',
      entityId: row.id,
      after: {
        visitId: dto.visitId ?? null,
        rating: dto.rating ?? null,
      },
    });

    return {
      id: row.id,
      createdAt: row.createdAt,
    };
  }

  private async assertOwnsQuotation(
    organizationId: string,
    customerId: string,
    quotationId: string,
  ) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id: quotationId, organizationId, customerId },
      select: { id: true },
    });
    if (!quote) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quotation not found',
      });
    }
  }
}

export function mapVisitToPortalStage(status: string): PortalStage {
  switch (status) {
    case 'waiting':
      return 'received';
    case 'inspection':
      return 'inspection';
    case 'waitingApproval':
      return 'quotation';
    case 'readyForRepair':
    case 'inProgress':
    case 'waitingParts':
      return 'inProgress';
    case 'qualityCheck':
      return 'qualityCheck';
    case 'readyForDelivery':
    case 'completed':
      return 'readyForDelivery';
    default:
      return 'received';
  }
}

function portalStageLabelEn(stage: PortalStage): string {
  const map: Record<PortalStage, string> = {
    received: 'Received',
    inspection: 'Inspection',
    quotation: 'Quotation',
    inProgress: 'In progress',
    qualityCheck: 'Quality check',
    readyForDelivery: 'Ready for delivery',
  };
  return map[stage];
}

function portalStageLabelAr(stage: PortalStage): string {
  const map: Record<PortalStage, string> = {
    received: 'تم الاستلام',
    inspection: 'الفحص',
    quotation: 'عرض السعر',
    inProgress: 'قيد الإصلاح',
    qualityCheck: 'فحص الجودة',
    readyForDelivery: 'جاهز للتسليم',
  };
  return map[stage];
}
