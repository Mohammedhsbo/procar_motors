import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DomainEventsService } from '../../common/services/domain-events.service';

/**
 * Reminder engine.
 *
 * Runs nightly and looks for the four things a service centre should chase:
 * an oil change coming due, a warranty about to expire, a scheduled service
 * date arriving, and a customer who has quietly stopped coming.
 *
 * Every reminder is emitted as a domain event rather than written straight to
 * a notification, so the same rule can later feed WhatsApp or email without
 * being rewritten.
 */
@Injectable()
export class ReminderEngineService {
  private readonly logger = new Logger(ReminderEngineService.name);

  /** Oil is due every 5,000 km; warn once the car is within 500 km. */
  private static readonly OIL_INTERVAL_KM = 5000;
  private static readonly OIL_WARN_KM = 500;
  /** Warn this many days before a warranty runs out. */
  private static readonly WARRANTY_WARN_DAYS = 30;
  /** A customer is "lapsed" after this long without a visit. */
  private static readonly LAPSED_MONTHS = 6;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async run() {
    const [oil, warranty, scheduled, lapsed] = await Promise.all([
      this.oilChangeDue(),
      this.warrantyExpiring(),
      this.scheduledServiceDue(),
      this.lapsedCustomers(),
    ]);

    const total = oil + warranty + scheduled + lapsed;
    this.logger.log(
      `reminders emitted: oil=${oil} warranty=${warranty} scheduled=${scheduled} lapsed=${lapsed}`,
    );
    return { oil, warranty, scheduled, lapsed, total };
  }

  /**
   * Vehicles whose odometer has passed the next oil-change threshold since
   * their last recorded service.
   */
  private async oilChangeDue(): Promise<number> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { deletedAt: null, status: 'active', mileageCurrent: { gt: 0 } },
      select: {
        id: true,
        organizationId: true,
        customerId: true,
        plate: true,
        mileageCurrent: true,
        visits: {
          where: { deletedAt: null, status: 'completed' },
          orderBy: { checkedInAt: 'desc' },
          take: 1,
          select: { mileageIn: true, checkedInAt: true },
        },
      },
      take: 500,
    });

    let emitted = 0;
    for (const v of vehicles) {
      const lastServiceKm = v.visits[0]?.mileageIn ?? 0;
      const since = (v.mileageCurrent ?? 0) - lastServiceKm;
      const threshold =
        ReminderEngineService.OIL_INTERVAL_KM - ReminderEngineService.OIL_WARN_KM;

      if (since < threshold) continue;
      if (await this.alreadySent('reminder.oil_change_due', v.id, 60)) continue;

      await this.events.emit('reminder.oil_change_due', {
        organizationId: v.organizationId,
        vehicleId: v.id,
        customerId: v.customerId,
        plate: v.plate,
        kmSinceService: since,
        intervalKm: ReminderEngineService.OIL_INTERVAL_KM,
      });
      emitted++;
    }
    return emitted;
  }

  /** Warranties running out inside the warning window. */
  private async warrantyExpiring(): Promise<number> {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + ReminderEngineService.WARRANTY_WARN_DAYS);

    const warranties = await this.prisma.warranty.findMany({
      where: { validUntil: { gte: now, lte: until } },
      select: {
        id: true,
        type: true,
        validUntil: true,
        vehicleId: true,
        vehicle: {
          select: { id: true, organizationId: true, customerId: true, plate: true },
        },
      },
      take: 500,
    });

    let emitted = 0;
    for (const w of warranties) {
      if (!w.vehicle) continue;
      if (await this.alreadySent('reminder.warranty_expiring', w.id, 30)) continue;

      await this.events.emit('reminder.warranty_expiring', {
        organizationId: w.vehicle.organizationId,
        warrantyId: w.id,
        vehicleId: w.vehicleId,
        customerId: w.vehicle.customerId,
        plate: w.vehicle.plate,
        type: w.type,
        validUntil: w.validUntil,
      });
      emitted++;
    }
    return emitted;
  }

  /** Visits with a promised delivery date that has arrived or passed. */
  private async scheduledServiceDue(): Promise<number> {
    const soon = new Date();
    soon.setHours(soon.getHours() + 24);

    const visits = await this.prisma.vehicleVisit.findMany({
      where: {
        deletedAt: null,
        expectedDeliveryAt: { lte: soon },
        status: { not: 'completed' },
      },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        customerId: true,
        status: true,
        expectedDeliveryAt: true,
        vehicle: { select: { plate: true } },
      },
      take: 500,
    });

    let emitted = 0;
    for (const v of visits) {
      if (await this.alreadySent('reminder.delivery_due', v.id, 1)) continue;

      await this.events.emit('reminder.delivery_due', {
        organizationId: v.organizationId,
        branchId: v.branchId,
        visitId: v.id,
        customerId: v.customerId,
        plate: v.vehicle?.plate ?? null,
        status: v.status,
        expectedDeliveryAt: v.expectedDeliveryAt,
        overdue: v.expectedDeliveryAt
          ? v.expectedDeliveryAt.getTime() < Date.now()
          : false,
      });
      emitted++;
    }
    return emitted;
  }

  /** Customers who have not been in for a while. */
  private async lapsedCustomers(): Promise<number> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ReminderEngineService.LAPSED_MONTHS);

    const rows = await this.prisma.$queryRaw<
      { id: string; organization_id: string; name_en: string; last_visit: Date }[]
    >`
      SELECT c.id, c.organization_id, c.name_en, MAX(v.checked_in_at) AS last_visit
      FROM core.customers c
      JOIN promotors.vehicle_visits v ON v.customer_id = c.id
      WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
      GROUP BY c.id, c.organization_id, c.name_en
      HAVING MAX(v.checked_in_at) < ${cutoff}
      LIMIT 200
    `;

    let emitted = 0;
    for (const row of rows) {
      if (await this.alreadySent('reminder.customer_lapsed', row.id, 90)) continue;

      await this.events.emit('reminder.customer_lapsed', {
        organizationId: row.organization_id,
        customerId: row.id,
        customerName: row.name_en,
        lastVisitAt: row.last_visit,
        months: ReminderEngineService.LAPSED_MONTHS,
      });
      emitted++;
    }
    return emitted;
  }

  /**
   * True when the same reminder was already emitted for this subject inside
   * the cooldown window — the engine runs nightly and must not nag.
   */
  private async alreadySent(
    eventType: string,
    subjectId: string,
    cooldownDays: number,
  ): Promise<boolean> {
    const since = new Date();
    since.setDate(since.getDate() - cooldownDays);

    const found = await this.prisma.outboxEvent.findFirst({
      where: {
        eventType,
        createdAt: { gte: since },
        payload: { string_contains: subjectId },
      },
      select: { id: true },
    });
    return Boolean(found);
  }
}
