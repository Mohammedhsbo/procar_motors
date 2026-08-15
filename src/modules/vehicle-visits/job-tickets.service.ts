import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';

@Injectable()
export class JobTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; status?: string },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.JobTicketWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.jobTicket.count({ where }),
      this.prisma.jobTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          visit: {
            include: {
              customer: true,
              vehicle: true,
              branch: true,
            },
          },
          workOrders: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      }),
    ]);

    return {
      data: rows.map((t) => this.toDto(t as never)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, id: string) {
    const ticket = await this.prisma.jobTicket.findFirst({
      where: { id, organizationId },
      include: {
        visit: {
          include: {
            customer: true,
            vehicle: true,
            branch: true,
            damagePoints: true,
          },
        },
        workOrders: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!ticket) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Job ticket not found',
      });
    }
    return this.toDto(ticket);
  }

  private toDto(ticket: {
    id: string;
    number: string;
    status: string;
    branchId: string;
    visitId: string;
    advisorId: string | null;
    createdAt: Date;
    workOrders: Array<{ number: string }>;
    visit: {
      status: string;
      priority: string;
      progressPct: number;
      complaint: string | null;
      checkedInAt: Date;
      expectedDeliveryAt: Date | null;
      customer: {
        nameEn: string;
        nameAr: string;
        phone: string;
      };
      vehicle: {
        make: string;
        model: string;
        plate: string;
        year: number;
      };
      branch: { code: string };
    };
  }) {
    return {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      branchId: ticket.branchId,
      visitId: ticket.visitId,
      advisorId: ticket.advisorId,
      createdAt: ticket.createdAt,
      wo: ticket.workOrders[0]?.number ?? null,
      visitStatus: ticket.visit.status,
      priority: ticket.visit.priority,
      progress: ticket.visit.progressPct,
      customer: ticket.visit.customer.nameEn,
      customerAr: ticket.visit.customer.nameAr,
      customerNameEn: ticket.visit.customer.nameEn,
      customerNameAr: ticket.visit.customer.nameAr,
      phone: ticket.visit.customer.phone,
      vehicle: `${ticket.visit.vehicle.make} ${ticket.visit.vehicle.model}`,
      plate: ticket.visit.vehicle.plate,
      year: ticket.visit.vehicle.year,
      branch: ticket.visit.branch.code,
      complaint: ticket.visit.complaint,
      checkedInAt: ticket.visit.checkedInAt,
      expectedDeliveryAt: ticket.visit.expectedDeliveryAt,
    };
  }
}
