import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    branchId: string,
    query: {
      page?: number;
      limit?: number;
      invoiceId?: string;
      method?: PaymentMethod;
      status?: PaymentStatus;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.PaymentWhereInput = {
      branchId,
      invoice: { organizationId },
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              customerId: true,
            },
          },
        },
      }),
    ]);
    return {
      data: rows.map((p) => ({
        id: p.id,
        number: p.number,
        invoiceId: p.invoiceId,
        invoiceNumber: p.invoice.number,
        invoiceStatus: p.invoice.status,
        branchId: p.branchId,
        amount: Number(p.amount),
        method: p.method,
        status: p.status,
        receivedBy: p.receivedBy,
        paidAt: p.paidAt,
        reference: p.reference,
        createdAt: p.createdAt,
      })),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }
}
