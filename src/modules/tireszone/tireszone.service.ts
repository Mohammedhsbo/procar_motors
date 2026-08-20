import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes';
import { NumberSequenceService } from '../../common/services/number-sequence.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES = ['draft', 'confirmed'];

@Injectable()
export class TireszoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // ── Catalogue ──────────────────────────────────────────────────────────

  async listProducts(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      brand?: string;
      width?: number;
      aspectRatio?: number;
      rimDiameter?: number;
      season?: string;
    },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);

    const where: Prisma.TireProductWhereInput = {
      organizationId,
      ...(query.brand ? { brand: query.brand } : {}),
      ...(query.width ? { width: query.width } : {}),
      ...(query.aspectRatio ? { aspectRatio: query.aspectRatio } : {}),
      ...(query.rimDiameter ? { rimDiameter: query.rimDiameter } : {}),
      ...(query.season ? { season: query.season } : {}),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { pattern: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tireProduct.findMany({
        where,
        include: { part: { include: { balances: true } } },
        orderBy: [{ brand: 'asc' }, { width: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tireProduct.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toProductDto(r)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProduct(organizationId: string, id: string) {
    const row = await this.prisma.tireProduct.findFirst({
      where: { id, organizationId },
      include: { part: { include: { balances: true } } },
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Tire product not found',
      });
    }
    return this.toProductDto(row);
  }

  /**
   * Registers a tire against an existing inventory part. Stock, cost and
   * movement stay in the inventory engine — this only adds tire attributes.
   */
  async createProduct(
    organizationId: string,
    actorId: string,
    dto: {
      partId: string;
      sku: string;
      nameEn: string;
      nameAr: string;
      brand: string;
      pattern?: string;
      width: number;
      aspectRatio: number;
      rimDiameter: number;
      season?: string;
      speedRating?: string;
      loadIndex?: string;
      runFlat?: boolean;
      dotWeek?: string;
      warrantyMonths?: number;
      warrantyKm?: number;
    },
  ) {
    const part = await this.prisma.part.findFirst({
      where: { id: dto.partId, organizationId, deletedAt: null },
    });
    if (!part) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Inventory part not found — create the part first',
      });
    }

    const existing = await this.prisma.tireProduct.findUnique({
      where: { partId: dto.partId },
    });
    if (existing) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'This part is already registered as a tire product',
      });
    }

    const created = await this.prisma.tireProduct.create({
      data: { organizationId, ...dto },
      include: { part: { include: { balances: true } } },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: 'tirezone.product.create',
      entity: 'TireProduct',
      entityId: created.id,
      after: created,
    });
    return this.toProductDto(created);
  }

  /** Tire Finder — sizes that fit a given vehicle, plus what is in stock. */
  async findForVehicle(
    organizationId: string,
    query: { make: string; model: string; year?: number },
  ) {
    const fitments = await this.prisma.tireFitment.findMany({
      where: {
        organizationId,
        make: { equals: query.make, mode: 'insensitive' },
        model: { equals: query.model, mode: 'insensitive' },
        ...(query.year
          ? {
              yearFrom: { lte: query.year },
              OR: [{ yearTo: null }, { yearTo: { gte: query.year } }],
            }
          : {}),
      },
      orderBy: { isOem: 'desc' },
    });

    if (fitments.length === 0) return { fitments: [], products: [] };

    const products = await this.prisma.tireProduct.findMany({
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
    });

    return {
      fitments: fitments.map((f) => ({
        id: f.id,
        size: `${f.width}/${f.aspectRatio}R${f.rimDiameter}`,
        width: f.width,
        aspectRatio: f.aspectRatio,
        rimDiameter: f.rimDiameter,
        position: f.position,
        isOem: f.isOem,
      })),
      products: products.map((p) => this.toProductDto(p)),
    };
  }

  listServices(organizationId: string) {
    return this.prisma.tireService.findMany({
      where: { organizationId, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  // ── Sales orders ───────────────────────────────────────────────────────

  async listOrders(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; status?: string; channel?: string },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.TireSalesOrderWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tireSalesOrder.findMany({
        where,
        include: this.orderInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tireSalesOrder.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toOrderDto(r)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOrder(organizationId: string, id: string) {
    return this.toOrderDto(await this.findOrderOrFail(organizationId, id));
  }

  async createOrder(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      channel?: string;
      customerId?: string;
      vehicleId?: string;
      visitId?: string;
      workOrderId?: string;
      odometer?: number;
      notes?: string;
    },
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'TZ');
      return tx.tireSalesOrder.create({
        data: {
          organizationId,
          branchId,
          number,
          channel: dto.channel ?? 'pos',
          status: 'draft',
          customerId: dto.customerId ?? null,
          vehicleId: dto.vehicleId ?? null,
          visitId: dto.visitId ?? null,
          workOrderId: dto.workOrderId ?? null,
          odometer: dto.odometer ?? null,
          notes: dto.notes ?? null,
          createdBy: actorId,
        },
        include: this.orderInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'tirezone.order.create',
      entity: 'TireSalesOrder',
      entityId: created.id,
      after: created,
    });
    return this.toOrderDto(created);
  }

  /** Replaces the order lines and recalculates totals. */
  async setOrderItems(
    organizationId: string,
    branchId: string,
    actorId: string,
    orderId: string,
    dto: {
      discount?: number;
      taxRatePct?: number;
      items: Array<{
        productId?: string;
        serviceId?: string;
        qty: number;
        unitPrice?: number;
        discount?: number;
      }>;
    },
  ) {
    const order = await this.findOrderOrFail(organizationId, orderId);
    this.assertOpen(order.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.tireSalesOrderItem.deleteMany({ where: { orderId } });

      let subtotal = 0;
      for (const [index, line] of dto.items.entries()) {
        const resolved = await this.resolveLine(tx, organizationId, line);
        const qty = Number(line.qty);
        if (!(qty > 0)) {
          throw new BadRequestException({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'qty must be greater than 0',
          });
        }
        const discount = Number(line.discount ?? 0);
        const lineTotal = qty * resolved.unitPrice - discount;
        subtotal += lineTotal;

        await tx.tireSalesOrderItem.create({
          data: {
            orderId,
            productId: resolved.productId,
            serviceId: resolved.serviceId,
            nameEn: resolved.nameEn,
            nameAr: resolved.nameAr,
            qty,
            unitPrice: resolved.unitPrice,
            discount,
            lineTotal,
            sortOrder: index,
          },
        });
      }

      const orderDiscount = Number(dto.discount ?? 0);
      const taxable = Math.max(subtotal - orderDiscount, 0);
      const tax = Number((taxable * ((dto.taxRatePct ?? 0) / 100)).toFixed(2));

      return tx.tireSalesOrder.update({
        where: { id: orderId },
        data: {
          subtotal,
          discount: orderDiscount,
          tax,
          total: taxable + tax,
        },
        include: this.orderInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'tirezone.order.items.update',
      entity: 'TireSalesOrder',
      entityId: orderId,
      after: updated,
    });
    return this.toOrderDto(updated);
  }

  /**
   * Completes the sale: issues stock for every tire line, raises an invoice in
   * the shared finance ledger, and records warranties. One transaction, so a
   * failure anywhere leaves stock and the ledger untouched.
   */
  async completeOrder(
    organizationId: string,
    branchId: string,
    actorId: string,
    orderId: string,
  ) {
    const order = await this.findOrderOrFail(organizationId, orderId);
    this.assertOpen(order.status);

    if (order.items.length === 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Cannot complete an order with no items',
      });
    }
    if (!order.customerId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'A customer is required before invoicing',
      });
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { branchId },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
    if (!warehouse) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Branch has no warehouse configured',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Issue stock for tire lines. Service lines hold no stock.
      for (const item of order.items) {
        if (!item.productId || !item.product) continue;
        await this.stock.applyMutation(tx, {
          organizationId,
          branchId,
          warehouseId: warehouse.id,
          partId: item.product.partId,
          deltaOnHand: -Number(item.qty),
          deltaReserved: 0,
          type: 'issue',
          requireAvailable: Number(item.qty),
          actorId,
          referenceType: 'tirezone_sales_order',
          referenceId: order.id,
          notes: `Tire Zone sale ${order.number}`,
        });
      }

      // 2. Raise the invoice in the shared ledger, tagged to this app.
      const invoiceNumber = await this.sequences.nextInTx(
        tx,
        organizationId,
        'INV',
      );
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          branchId,
          customerId: order.customerId!,
          number: invoiceNumber,
          sourceApp: 'tirezone',
          sourceRefType: 'tirezone.sales_order',
          sourceRef: order.id,
          status: 'draft',
          subtotal: order.subtotal,
          discount: order.discount,
          tax: order.tax,
          total: order.total,
          amountPaid: 0,
          createdBy: actorId,
          items: {
            create: order.items.map((i, idx) => ({
              kind: i.productId ? 'tire' : 'service',
              nameEn: i.nameEn,
              nameAr: i.nameAr,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
              sortOrder: i.sortOrder ?? idx,
            })),
          },
        },
      });

      // 3. Start warranty cover on every tire sold.
      for (const item of order.items) {
        if (!item.product) continue;
        const months = item.product.warrantyMonths;
        const km = item.product.warrantyKm;
        if (!months && !km) continue;
        await tx.tireWarranty.create({
          data: {
            orderItemId: item.id,
            months: months ?? null,
            kmLimit: km ?? null,
            startOdometer: order.odometer ?? null,
            expiresAt: months
              ? new Date(
                  new Date().setMonth(new Date().getMonth() + months),
                )
              : null,
          },
        });
      }

      return tx.tireSalesOrder.update({
        where: { id: order.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          invoiceId: invoice.id,
        },
        include: this.orderInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'tirezone.order.complete',
      entity: 'TireSalesOrder',
      entityId: order.id,
      before: order,
      after: result,
    });
    return this.toOrderDto(result);
  }

  async cancelOrder(
    organizationId: string,
    branchId: string,
    actorId: string,
    orderId: string,
    reason?: string,
  ) {
    const order = await this.findOrderOrFail(organizationId, orderId);
    if (order.status === 'completed') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'A completed sale cannot be cancelled — issue a refund instead',
      });
    }

    const updated = await this.prisma.tireSalesOrder.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        notes: reason ? `${order.notes ?? ''}\nCancelled: ${reason}`.trim() : order.notes,
      },
      include: this.orderInclude(),
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'tirezone.order.cancel',
      entity: 'TireSalesOrder',
      entityId: orderId,
      after: updated,
    });
    return this.toOrderDto(updated);
  }

  /** Records before/after wheel alignment readings for a sale. */
  async recordAlignment(
    organizationId: string,
    actorId: string,
    orderId: string,
    dto: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      technicianId?: string;
      notes?: string;
    },
  ) {
    await this.findOrderOrFail(organizationId, orderId);
    return this.prisma.tireAlignment.upsert({
      where: { orderId },
      create: {
        orderId,
        before: (dto.before ?? null) as Prisma.InputJsonValue,
        after: (dto.after ?? null) as Prisma.InputJsonValue,
        technicianId: dto.technicianId ?? actorId,
        notes: dto.notes ?? null,
      },
      update: {
        before: (dto.before ?? null) as Prisma.InputJsonValue,
        after: (dto.after ?? null) as Prisma.InputJsonValue,
        technicianId: dto.technicianId ?? actorId,
        notes: dto.notes ?? null,
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async resolveLine(
    tx: Tx,
    organizationId: string,
    line: { productId?: string; serviceId?: string; unitPrice?: number },
  ) {
    if (Boolean(line.productId) === Boolean(line.serviceId)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Each line must reference exactly one product or one service',
      });
    }

    if (line.productId) {
      const product = await tx.tireProduct.findFirst({
        where: { id: line.productId, organizationId },
        include: { part: true },
      });
      if (!product) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Tire product not found',
        });
      }
      return {
        productId: product.id,
        serviceId: null,
        nameEn: product.nameEn,
        nameAr: product.nameAr,
        unitPrice: line.unitPrice ?? Number(product.part.sellPrice),
      };
    }

    const service = await tx.tireService.findFirst({
      where: { id: line.serviceId, organizationId },
    });
    if (!service) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Tire service not found',
      });
    }
    return {
      productId: null,
      serviceId: service.id,
      nameEn: service.nameEn,
      nameAr: service.nameAr,
      unitPrice: line.unitPrice ?? Number(service.price),
    };
  }

  private assertOpen(status: string) {
    if (!OPEN_STATUSES.includes(status)) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: `Order is ${status} and can no longer be edited`,
      });
    }
  }

  private async findOrderOrFail(organizationId: string, id: string) {
    const order = await this.prisma.tireSalesOrder.findFirst({
      where: { id, organizationId },
      include: this.orderInclude(),
    });
    if (!order) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Sales order not found',
      });
    }
    return order;
  }

  private orderInclude() {
    return {
      customer: { select: { id: true, nameEn: true, nameAr: true, phone: true } },
      vehicle: { select: { id: true, plate: true, make: true, model: true, year: true } },
      items: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          product: true,
          service: true,
          warranty: true,
        },
      },
      alignment: true,
    };
  }

  private toProductDto(row: {
    id: string;
    partId: string;
    sku: string;
    nameEn: string;
    nameAr: string;
    brand: string;
    pattern: string | null;
    width: number;
    aspectRatio: number;
    rimDiameter: number;
    season: string;
    speedRating: string | null;
    loadIndex: string | null;
    runFlat: boolean;
    dotWeek: string | null;
    warrantyMonths: number | null;
    warrantyKm: number | null;
    part: {
      sku: string;
      sellPrice: Prisma.Decimal;
      costPrice: Prisma.Decimal;
      minStock: number;
      balances: Array<{ onHand: Prisma.Decimal; reserved: Prisma.Decimal }>;
    };
  }) {
    const onHand = row.part.balances.reduce(
      (sum, b) => sum + Number(b.onHand),
      0,
    );
    const reserved = row.part.balances.reduce(
      (sum, b) => sum + Number(b.reserved),
      0,
    );
    return {
      id: row.id,
      partId: row.partId,
      sku: row.sku,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      brand: row.brand,
      pattern: row.pattern,
      size: `${row.width}/${row.aspectRatio}R${row.rimDiameter}`,
      width: row.width,
      aspectRatio: row.aspectRatio,
      rimDiameter: row.rimDiameter,
      season: row.season,
      speedRating: row.speedRating,
      loadIndex: row.loadIndex,
      runFlat: row.runFlat,
      dotWeek: row.dotWeek,
      warrantyMonths: row.warrantyMonths,
      warrantyKm: row.warrantyKm,
      price: Number(row.part.sellPrice),
      cost: Number(row.part.costPrice),
      onHand,
      reserved,
      available: onHand - reserved,
      minStock: row.part.minStock,
      stockState:
        onHand - reserved <= 0
          ? 'out'
          : onHand - reserved <= row.part.minStock
            ? 'low'
            : 'in',
    };
  }

  private toOrderDto(order: {
    id: string;
    number: string;
    channel: string;
    status: string;
    branchId: string;
    odometer: number | null;
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
    invoiceId: string | null;
    visitId: string | null;
    notes: string | null;
    completedAt: Date | null;
    createdAt: Date;
    customer: { id: string; nameEn: string; nameAr: string; phone: string | null } | null;
    vehicle: { id: string; plate: string; make: string; model: string; year: number } | null;
    items: Array<{
      id: string;
      productId: string | null;
      serviceId: string | null;
      nameEn: string;
      nameAr: string;
      qty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      sortOrder: number;
      warranty: { months: number | null; kmLimit: number | null; expiresAt: Date | null } | null;
    }>;
    alignment: { before: unknown; after: unknown; notes: string | null } | null;
  }) {
    return {
      id: order.id,
      number: order.number,
      channel: order.channel,
      status: order.status,
      branchId: order.branchId,
      odometer: order.odometer,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      tax: Number(order.tax),
      total: Number(order.total),
      invoiceId: order.invoiceId,
      visitId: order.visitId,
      notes: order.notes,
      completedAt: order.completedAt,
      createdAt: order.createdAt,
      customer: order.customer,
      vehicle: order.vehicle,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        serviceId: i.serviceId,
        kind: i.productId ? 'tire' : 'service',
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discount),
        lineTotal: Number(i.lineTotal),
        sortOrder: i.sortOrder,
        warranty: i.warranty,
      })),
      alignment: order.alignment,
    };
  }
}
