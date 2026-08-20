import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DomainEventsService } from '../../common/services/domain-events.service';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Cross-business flows. Each one starts in one application and lands in
 * another, which is what turns four products into one platform:
 *
 *  · the workshop finds a vehicle needs tires  → a Tire Zone order
 *  · a customer waits while their car is in    → a Daily Cup order on the visit
 *  · anyone asks "what is happening with this car" → one answer
 */
@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everything happening for one vehicle visit, across every application.
   * Reception and the customer portal both read this.
   */
  async visitContext(organizationId: string, visitId: string) {
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id: visitId, organizationId, deletedAt: null },
      include: {
        customer: { select: { id: true, nameEn: true, nameAr: true, phone: true } },
        vehicle: { select: { id: true, plate: true, make: true, model: true, year: true } },
        branch: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }

    const [tireOrders, cafeOrders, uxbJobs] = await Promise.all([
      this.prisma.tireSalesOrder.findMany({
        where: { visitId, organizationId },
        orderBy: { createdAt: 'desc' },
        include: { items: { select: { nameEn: true, nameAr: true, qty: true, lineTotal: true } } },
      }),
      this.prisma.cafeOrder.findMany({
        where: { visitId, organizationId },
        orderBy: { createdAt: 'desc' },
        include: { items: { select: { nameEn: true, nameAr: true, qty: true } } },
      }),
      this.prisma.uxbJob.findMany({
        where: { visitId, organizationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, stage: true, total: true },
      }),
    ]);

    /**
     * A customer whose car is still in the centre can order from the café;
     * once the visit is completed they have gone home.
     */
    const customerIsWaiting = visit.status !== 'completed';

    return {
      visit: {
        id: visit.id,
        status: visit.status,
        checkedInAt: visit.checkedInAt,
        expectedDeliveryAt: visit.expectedDeliveryAt,
        branch: visit.branch,
        customer: visit.customer,
        vehicle: visit.vehicle,
      },
      canOrderFromCafe: customerIsWaiting,
      tirezone: tireOrders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        total: Number(o.total),
        items: o.items.map((i) => ({
          nameEn: i.nameEn,
          nameAr: i.nameAr,
          qty: Number(i.qty),
          lineTotal: Number(i.lineTotal),
        })),
      })),
      dailycup: cafeOrders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        total: Number(o.total),
        readyAt: o.readyAt,
        items: o.items.map((i) => ({
          nameEn: i.nameEn,
          nameAr: i.nameAr,
          qty: Number(i.qty),
        })),
      })),
      uxb: uxbJobs.map((j) => ({
        id: j.id,
        number: j.number,
        stage: j.stage,
        total: Number(j.total),
      })),
    };
  }

  /**
   * The workshop discovered the vehicle needs tires. Looks up what fits the
   * car, opens a Tire Zone order against this visit, and hands back the
   * options so the advisor can price them into the quotation.
   */
  async requestTires(
    organizationId: string,
    branchId: string,
    actorId: string,
    visitId: string,
    dto: { qty?: number; productId?: string; notes?: string },
  ) {
    const visit = await this.prisma.vehicleVisit.findFirst({
      where: { id: visitId, organizationId, deletedAt: null },
      include: {
        vehicle: { select: { id: true, make: true, model: true, year: true, mileageCurrent: true } },
      },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }

    // What fits this car?
    const fitments = await this.prisma.tireFitment.findMany({
      where: {
        organizationId,
        make: { equals: visit.vehicle.make, mode: 'insensitive' },
        model: { equals: visit.vehicle.model, mode: 'insensitive' },
        yearFrom: { lte: visit.vehicle.year },
        OR: [{ yearTo: null }, { yearTo: { gte: visit.vehicle.year } }],
      },
    });

    const options = fitments.length
      ? await this.prisma.tireProduct.findMany({
          where: {
            organizationId,
            OR: fitments.map((f) => ({
              width: f.width,
              aspectRatio: f.aspectRatio,
              rimDiameter: f.rimDiameter,
            })),
          },
          include: { part: { include: { balances: true } } },
          orderBy: { brand: 'asc' },
        })
      : [];

    const chosen = dto.productId
      ? options.find((p) => p.id === dto.productId)
      : undefined;
    if (dto.productId && !chosen) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'That tire does not fit this vehicle',
      });
    }

    const qty = dto.qty ?? 4;

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'TZ');
      const created = await tx.tireSalesOrder.create({
        data: {
          organizationId,
          branchId,
          number,
          channel: 'workshop_request',
          status: 'draft',
          customerId: visit.customerId,
          vehicleId: visit.vehicleId,
          visitId: visit.id,
          odometer: visit.vehicle.mileageCurrent ?? null,
          notes: dto.notes ?? null,
          createdBy: actorId,
        },
      });

      if (chosen) {
        const unitPrice = Number(chosen.part.sellPrice);
        await tx.tireSalesOrderItem.create({
          data: {
            orderId: created.id,
            productId: chosen.id,
            nameEn: chosen.nameEn,
            nameAr: chosen.nameAr,
            qty,
            unitPrice,
            lineTotal: unitPrice * qty,
            sortOrder: 0,
          },
        });
        await tx.tireSalesOrder.update({
          where: { id: created.id },
          data: { subtotal: unitPrice * qty, total: unitPrice * qty },
        });
      }

      await this.events.emit(
        'inspection.tires_required',
        {
          visitId: visit.id,
          vehicleId: visit.vehicleId,
          customerId: visit.customerId,
          tireOrderId: created.id,
          qty,
        },
        tx,
      );

      return created;
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'integration.tires.requested',
      entity: 'TireSalesOrder',
      entityId: order.id,
      after: order,
    });

    return {
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        channel: order.channel,
        total: Number(order.total),
      },
      vehicle: visit.vehicle,
      fitments: fitments.map((f) => ({
        size: `${f.width}/${f.aspectRatio}R${f.rimDiameter}`,
        position: f.position,
        isOem: f.isOem,
      })),
      options: options.map((p) => {
        const onHand = p.part.balances.reduce((s, b) => s + Number(b.onHand), 0);
        const reserved = p.part.balances.reduce(
          (s, b) => s + Number(b.reserved),
          0,
        );
        return {
          id: p.id,
          brand: p.brand,
          pattern: p.pattern,
          size: `${p.width}/${p.aspectRatio}R${p.rimDiameter}`,
          price: Number(p.part.sellPrice),
          available: onHand - reserved,
        };
      }),
    };
  }

  /**
   * The customer is waiting in the lounge and orders a coffee. The order is
   * tied to the visit so the barista knows which car it belongs to, and the
   * customer portal can show it.
   */
  async orderFromCafe(
    organizationId: string,
    branchId: string,
    actorId: string,
    visitId: string,
    dto: { items: { variantId: string; qty: number }[]; tableRef?: string },
  ) {
    const context = await this.visitContext(organizationId, visitId);
    if (!context.canOrderFromCafe) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          'Café ordering is only available while the vehicle is still in the centre',
      });
    }
    if (!dto.items.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'An order needs at least one item',
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'DC');
      const created = await tx.cafeOrder.create({
        data: {
          organizationId,
          branchId,
          number,
          type: 'waiting_area',
          status: 'open',
          customerId: context.visit.customer?.id ?? null,
          visitId,
          tableRef: dto.tableRef ?? null,
          employeeId: actorId,
        },
      });

      let subtotal = 0;
      for (const [index, line] of dto.items.entries()) {
        const variant = await tx.cafeProductVariant.findFirst({
          where: { id: line.variantId, product: { organizationId } },
          include: { product: true },
        });
        if (!variant) {
          throw new NotFoundException({
            code: ErrorCodes.NOT_FOUND,
            message: 'Menu item not found',
          });
        }
        const price = Number(variant.price);
        const lineTotal = price * line.qty;
        subtotal += lineTotal;

        await tx.cafeOrderItem.create({
          data: {
            orderId: created.id,
            variantId: variant.id,
            nameEn: `${variant.product.nameEn} ${variant.nameEn}`.trim(),
            nameAr: `${variant.product.nameAr} ${variant.nameAr}`.trim(),
            qty: line.qty,
            unitPrice: price,
            lineTotal,
            sortOrder: index,
          },
        });
      }

      const updated = await tx.cafeOrder.update({
        where: { id: created.id },
        data: { subtotal, total: subtotal },
      });

      await this.events.emit(
        'cafe.waiting_area_order',
        { visitId, cafeOrderId: created.id, branchId },
        tx,
      );

      return updated;
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'integration.cafe.waiting_order',
      entity: 'CafeOrder',
      entityId: order.id,
      after: order,
    });

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      total: Number(order.total),
      visitId,
    };
  }
}
