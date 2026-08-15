import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { AuditService } from '../audit/audit.service';
import { QuotationCalculatorService } from '../quotations/quotation-calculator.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
    private readonly calculator: QuotationCalculatorService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      status?: InvoiceStatus;
      visitId?: string;
      customerId?: string;
      q?: string;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.visitId ? { visitId: query.visitId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              {
                customer: {
                  OR: [
                    { nameEn: { contains: query.q, mode: 'insensitive' } },
                    { nameAr: { contains: query.q, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.include(),
      }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    return this.toDto(await this.findOrFail(organizationId, id));
  }

  async createFromQuotation(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: { quotationId: string; dueAt?: string },
  ) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id: dto.quotationId, organizationId, branchId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Quotation not found',
      });
    }
    if (quote.status !== 'approved') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Quotation must be approved (got ${quote.status})`,
      });
    }

    const existing = await this.prisma.invoice.findFirst({
      where: {
        organizationId,
        quotationId: quote.id,
        status: { not: 'cancelled' },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'An active invoice already exists for this quotation',
        details: { invoiceId: existing.id, number: existing.number },
      });
    }

    const wo = await this.prisma.workOrder.findFirst({
      where: { visitId: quote.visitId, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'INV');
      return tx.invoice.create({
        data: {
          organizationId,
          branchId,
          visitId: quote.visitId,
          jobTicketId: quote.jobTicketId,
          workOrderId: wo?.id,
          quotationId: quote.id,
          customerId: quote.customerId,
          number,
          status: 'draft',
          subtotal: quote.subtotal,
          discount: quote.discount,
          tax: quote.tax,
          total: quote.total,
          amountPaid: 0,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          createdBy: actorId,
          items: {
            create: quote.items.map((i, idx) => ({
              kind: i.kind,
              nameEn: i.nameEn,
              nameAr: i.nameAr,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
              sortOrder: i.sortOrder ?? idx,
            })),
          },
        },
        include: this.include(),
      });
    });

    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'invoice.create',
      entity: 'Invoice',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  async issue(organizationId: string, actorId: string, id: string) {
    const existing = await this.findOrFail(organizationId, id);
    if (existing.status !== 'draft') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot issue invoice in status ${existing.status}`,
      });
    }
    if (!existing.items.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invoice has no line items',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.invoice.updateMany({
        where: { id, organizationId, status: 'draft' },
        data: { status: 'issued', issuedAt: new Date() },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Invoice was modified by another request',
        });
      }
      await this.events.emit(
        'invoice.issued',
        {
          invoiceId: id,
          number: existing.number,
          visitId: existing.visitId,
          total: Number(existing.total),
        },
        tx,
      );
      return tx.invoice.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: existing.branchId,
      actorId,
      action: 'invoice.issue',
      entity: 'Invoice',
      entityId: id,
      before: { status: existing.status },
      after: result,
    });
    return result;
  }

  async cancel(
    organizationId: string,
    actorId: string,
    id: string,
    dto?: { reason?: string },
  ) {
    const existing = await this.findOrFail(organizationId, id);
    if (!['draft', 'issued'].includes(existing.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot cancel invoice in status ${existing.status}`,
      });
    }
    if (Number(existing.amountPaid) > 0) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'Cannot cancel an invoice that has payments',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.invoice.updateMany({
        where: {
          id,
          organizationId,
          status: existing.status,
          amountPaid: 0,
        },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: dto?.reason,
        },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Invoice was modified by another request',
        });
      }
      await this.events.emit(
        'invoice.cancelled',
        { invoiceId: id, number: existing.number },
        tx,
      );
      return tx.invoice.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId: existing.branchId,
      actorId,
      action: 'invoice.cancel',
      entity: 'Invoice',
      entityId: id,
      before: { status: existing.status },
      after: result,
    });
    return result;
  }

  async pay(
    organizationId: string,
    branchId: string,
    actorId: string,
    id: string,
    dto: {
      amount: number;
      method: PaymentMethod;
      reference?: string;
      paidAt?: string;
    },
  ) {
    const existing = await this.findOrFail(organizationId, id);
    if (existing.branchId !== branchId) {
      throw new ConflictException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Invoice does not belong to this branch',
      });
    }
    if (!['issued', 'partial'].includes(existing.status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Cannot pay invoice in status ${existing.status}`,
      });
    }

    const amount = this.calculator.round2(Number(dto.amount));
    if (!(amount > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Payment amount must be > 0',
      });
    }
    const remaining = this.calculator.round2(
      Number(existing.total) - Number(existing.amountPaid),
    );
    if (amount > remaining + 1e-9) {
      throw new ConflictException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Payment exceeds remaining balance',
        details: { amount, remaining },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const payNumber = await this.sequences.nextInTx(
        tx,
        organizationId,
        'PAY',
      );
      const payment = await tx.payment.create({
        data: {
          invoiceId: id,
          branchId,
          number: payNumber,
          amount,
          method: dto.method,
          status: 'confirmed',
          receivedBy: actorId,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          reference: dto.reference,
        },
      });

      const newPaid = this.calculator.round2(
        Number(existing.amountPaid) + amount,
      );
      const nextStatus: InvoiceStatus =
        newPaid + 1e-9 >= Number(existing.total) ? 'paid' : 'partial';

      const moved = await tx.invoice.updateMany({
        where: {
          id,
          organizationId,
          status: existing.status,
          amountPaid: existing.amountPaid,
        },
        data: { amountPaid: newPaid, status: nextStatus },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Invoice was modified by another payment',
        });
      }

      await this.events.emit(
        'payment.received',
        {
          organizationId,
          branchId,
          paymentId: payment.id,
          invoiceId: id,
          amount,
          method: dto.method,
          invoiceStatus: nextStatus,
        },
        tx,
      );

      return tx.invoice.findFirstOrThrow({
        where: { id },
        include: this.include(),
      });
    });

    const result = this.toDto(updated);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'invoice.pay',
      entity: 'Invoice',
      entityId: id,
      after: result,
    });
    return result;
  }

  /**
   * Outstanding balance for a visit (issued + partial invoices).
   */
  async visitOutstanding(organizationId: string, visitId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        visitId,
        status: { in: ['issued', 'partial', 'paid'] },
      },
    });
    const outstanding = this.calculator.round2(
      invoices
        .filter((i) => i.status !== 'paid')
        .reduce((s, i) => s + (Number(i.total) - Number(i.amountPaid)), 0),
    );
    return {
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        total: Number(i.total),
        amountPaid: Number(i.amountPaid),
        remaining: this.calculator.round2(
          Number(i.total) - Number(i.amountPaid),
        ),
      })),
      outstanding,
      fullyPaid:
        invoices.length > 0 &&
        invoices.every((i) => i.status === 'paid') &&
        outstanding <= 0,
      hasIssuedInvoice: invoices.length > 0,
    };
  }

  private async findOrFail(organizationId: string, id: string) {
    const row = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: this.include(),
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Invoice not found',
      });
    }
    return row;
  }

  private include() {
    return {
      items: { orderBy: { sortOrder: 'asc' as const } },
      payments: { orderBy: { createdAt: 'desc' as const } },
      customer: {
        select: { id: true, nameEn: true, nameAr: true, phone: true },
      },
      quotation: { select: { id: true, number: true, version: true } },
    } as const;
  }

  toDto(
    row: Prisma.InvoiceGetPayload<{
      include: ReturnType<InvoicesService['include']>;
    }>,
  ) {
    const total = Number(row.total);
    const amountPaid = Number(row.amountPaid);
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      number: row.number,
      status: row.status,
      visitId: row.visitId,
      jobTicketId: row.jobTicketId,
      workOrderId: row.workOrderId,
      quotationId: row.quotationId,
      quotation: row.quotation,
      customerId: row.customerId,
      customer: row.customer,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      tax: Number(row.tax),
      total,
      amountPaid,
      paid: amountPaid,
      remaining: this.calculator.round2(total - amountPaid),
      issuedAt: row.issuedAt,
      dueAt: row.dueAt,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      items: row.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        sortOrder: i.sortOrder,
      })),
      payments: row.payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount: Number(p.amount),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        reference: p.reference,
      })),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
