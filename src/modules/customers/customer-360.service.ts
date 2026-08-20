import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes';
import { PrismaService } from '../../database/prisma.service';

/**
 * Customer 360 — one person's whole relationship with the group, gathered from
 * every application. This is the payoff for the single-customer decision: the
 * same `core.customers` row is referenced by workshop visits, UXB jobs, tire
 * sales and café orders, so it can all be read back together.
 */
@Injectable()
export class Customer360Service {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Customer not found',
      });
    }

    const [
      vehicles,
      visits,
      uxbJobs,
      tireOrders,
      cafeOrders,
      invoices,
      lastVisit,
    ] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { customerId, organizationId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          plate: true,
          make: true,
          model: true,
          year: true,
          mileageCurrent: true,
          status: true,
        },
      }),
      this.prisma.vehicleVisit.findMany({
        where: { customerId, organizationId, deletedAt: null },
        orderBy: { checkedInAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          complaint: true,
          checkedInAt: true,
          deliveredAt: true,
          vehicle: { select: { plate: true, make: true, model: true } },
        },
      }),
      this.prisma.uxbJob.findMany({
        where: { customerId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          stage: true,
          total: true,
          createdAt: true,
          vehicle: { select: { plate: true } },
        },
      }),
      this.prisma.tireSalesOrder.findMany({
        where: { customerId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
          items: { select: { nameEn: true, qty: true } },
        },
      }),
      this.prisma.cafeOrder.findMany({
        where: { customerId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['sourceApp'],
        where: { customerId, organizationId },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.vehicleVisit.findFirst({
        where: { customerId, organizationId, deletedAt: null },
        orderBy: { checkedInAt: 'desc' },
        select: { checkedInAt: true },
      }),
    ]);

    const spendByApp = Object.fromEntries(
      invoices.map((row) => [
        row.sourceApp,
        {
          invoices: row._count._all,
          billed: Number(row._sum.total ?? 0),
          paid: Number(row._sum.amountPaid ?? 0),
        },
      ]),
    );

    const totalBilled = invoices.reduce(
      (sum, r) => sum + Number(r._sum.total ?? 0),
      0,
    );
    const totalPaid = invoices.reduce(
      (sum, r) => sum + Number(r._sum.amountPaid ?? 0),
      0,
    );

    return {
      customer: {
        id: customer.id,
        nameEn: customer.nameEn,
        nameAr: customer.nameAr,
        phone: customer.phone,
        whatsapp: customer.whatsapp,
        email: customer.email,
        status: customer.status,
        createdAt: customer.createdAt,
      },

      summary: {
        vehicles: vehicles.length,
        workshopVisits: visits.length,
        uxbJobs: uxbJobs.length,
        tirePurchases: tireOrders.length,
        cafeOrders: cafeOrders.length,
        totalBilled,
        totalPaid,
        outstanding: Number((totalBilled - totalPaid).toFixed(2)),
        lastVisitAt: lastVisit?.checkedInAt ?? null,
      },

      spendByApp,

      vehicles,

      activity: {
        promotors: visits.map((v) => ({
          id: v.id,
          kind: 'visit' as const,
          status: v.status,
          label: v.complaint,
          vehicle: v.vehicle
            ? `${v.vehicle.make} ${v.vehicle.model} · ${v.vehicle.plate}`
            : null,
          at: v.checkedInAt,
          closedAt: v.deliveredAt,
        })),
        uxb: uxbJobs.map((j) => ({
          id: j.id,
          kind: 'uxb_job' as const,
          number: j.number,
          status: j.stage,
          amount: Number(j.total),
          vehicle: j.vehicle?.plate ?? null,
          at: j.createdAt,
        })),
        tirezone: tireOrders.map((o) => ({
          id: o.id,
          kind: 'tire_order' as const,
          number: o.number,
          status: o.status,
          amount: Number(o.total),
          label: o.items.map((i) => `${i.qty}× ${i.nameEn}`).join(', '),
          at: o.createdAt,
        })),
        dailycup: cafeOrders.map((o) => ({
          id: o.id,
          kind: 'cafe_order' as const,
          number: o.number,
          status: o.status,
          amount: Number(o.total),
          at: o.createdAt,
        })),
      },
    };
  }
}
