import { Injectable } from '@nestjs/common';
import { VisitStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const BOARD_COLUMNS: VisitStatus[] = [
  'waiting',
  'inspection',
  'waitingApproval',
  'readyForRepair',
  'inProgress',
  'waitingParts',
  'qualityCheck',
  'readyForDelivery',
  'completed',
];

@Injectable()
export class WorkshopBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard(organizationId: string, branchId: string) {
    const visits = await this.prisma.vehicleVisit.findMany({
      where: {
        organizationId,
        branchId,
        deletedAt: null,
        status: { not: 'completed' },
      },
      orderBy: { checkedInAt: 'asc' },
      include: {
        customer: true,
        vehicle: true,
        jobTicket: true,
        workOrders: {
          where: { status: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const cards = visits.map((v) => {
      const elapsedMs = Date.now() - v.checkedInAt.getTime();
      const hours = Math.floor(elapsedMs / 3_600_000);
      const mins = Math.floor((elapsedMs % 3_600_000) / 60_000);
      const wo = v.workOrders[0];
      return {
        id: v.id,
        status: v.status,
        version: v.version,
        priority: v.priority,
        progress: v.progressPct,
        progressPct: v.progressPct,
        ticket: v.jobTicket?.number ?? null,
        wo: wo?.number ?? null,
        workOrderId: wo?.id ?? null,
        technicianId: wo?.technicianId ?? null,
        customer: v.customer.nameEn,
        customerAr: v.customer.nameAr,
        phone: v.customer.phone,
        vehicle: `${v.vehicle.make} ${v.vehicle.model}`,
        plate: v.vehicle.plate,
        year: v.vehicle.year,
        complaint: v.complaint,
        elapsed: `${hours}h ${mins}m`,
        checkedInAt: v.checkedInAt,
        expectedDeliveryAt: v.expectedDeliveryAt,
      };
    });

    const columns = BOARD_COLUMNS.map((key) => ({
      key,
      labelKey: `status.${key}`,
      cards: cards.filter((c) => c.status === key),
    }));

    return {
      columns,
      totals: {
        active: cards.length,
        byStatus: Object.fromEntries(
          BOARD_COLUMNS.map((k) => [
            k,
            cards.filter((c) => c.status === k).length,
          ]),
        ),
      },
    };
  }
}
