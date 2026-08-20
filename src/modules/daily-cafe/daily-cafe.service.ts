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

@Injectable()
export class DailyCafeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // ── Menu ───────────────────────────────────────────────────────────────

  listCategories(organizationId: string) {
    return this.prisma.cafeCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** The POS menu: active products with their sellable sizes. */
  async menu(organizationId: string) {
    const categories = await this.prisma.cafeCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            variants: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    return categories.map((c) => ({
      id: c.id,
      code: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      products: c.products.map((p) => ({
        id: p.id,
        code: p.code,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        description: p.description,
        imageFileId: p.imageFileId,
        variants: p.variants.map((v) => ({
          id: v.id,
          size: v.size,
          nameEn: v.nameEn,
          nameAr: v.nameAr,
          price: Number(v.price),
          recipeId: v.recipeId,
        })),
      })),
    }));
  }

  listModifiers(organizationId: string) {
    return this.prisma.cafeModifier.findMany({
      where: { organizationId, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  // ── Costing ────────────────────────────────────────────────────────────

  /**
   * Cost of one yield unit of a recipe, from live ingredient cost prices.
   * Waste percentage is included, so 2% grinding loss shows up in the cup.
   */
  async recipeCost(organizationId: string, recipeId: string) {
    const recipe = await this.prisma.cafeRecipe.findFirst({
      where: { id: recipeId, organizationId },
      include: { items: { include: { part: true } } },
    });
    if (!recipe) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Recipe not found',
      });
    }

    const lines = recipe.items.map((i) => {
      const grossQty = Number(i.qty) * (1 + Number(i.wastePct));
      const unitCost = Number(i.part.costPrice);
      return {
        partId: i.partId,
        sku: i.part.sku,
        nameEn: i.part.nameEn,
        nameAr: i.part.nameAr,
        qty: Number(i.qty),
        wastePct: Number(i.wastePct),
        grossQty: Number(grossQty.toFixed(4)),
        unit: i.unit,
        unitCost,
        lineCost: Number((grossQty * unitCost).toFixed(4)),
      };
    });

    const totalCost = lines.reduce((sum, l) => sum + l.lineCost, 0);
    const yieldQty = Number(recipe.yieldQty) || 1;

    return {
      recipeId: recipe.id,
      code: recipe.code,
      nameEn: recipe.nameEn,
      nameAr: recipe.nameAr,
      yieldQty,
      yieldUnit: recipe.yieldUnit,
      lines,
      totalCost: Number(totalCost.toFixed(4)),
      costPerUnit: Number((totalCost / yieldQty).toFixed(4)),
    };
  }

  /** Cost, price and margin for every sellable variant. */
  async costingReport(organizationId: string) {
    const variants = await this.prisma.cafeProductVariant.findMany({
      where: { isActive: true, product: { organizationId } },
      include: {
        product: true,
        recipe: { include: { items: { include: { part: true } } } },
      },
      orderBy: { product: { sortOrder: 'asc' } },
    });

    return variants.map((v) => {
      const cost = v.recipe
        ? this.computeRecipeCost(v.recipe)
        : { costPerUnit: 0 };
      const price = Number(v.price);
      const margin = price - cost.costPerUnit;
      return {
        variantId: v.id,
        productNameEn: v.product.nameEn,
        productNameAr: v.product.nameAr,
        size: v.size,
        price,
        cost: Number(cost.costPerUnit.toFixed(4)),
        margin: Number(margin.toFixed(4)),
        marginPct: price > 0 ? Number(((margin / price) * 100).toFixed(1)) : 0,
        hasRecipe: Boolean(v.recipeId),
      };
    });
  }

  // ── Cash sessions ──────────────────────────────────────────────────────

  async openSession(
    organizationId: string,
    branchId: string,
    actorId: string,
    openingFloat: number,
  ) {
    const existing = await this.prisma.cafeCashSession.findFirst({
      where: { branchId, status: 'open' },
    });
    if (existing) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'A cash session is already open at this branch',
        details: { sessionId: existing.id },
      });
    }

    return this.prisma.cafeCashSession.create({
      data: {
        organizationId,
        branchId,
        openedBy: actorId,
        openingFloat,
        status: 'open',
      },
    });
  }

  async closeSession(
    organizationId: string,
    actorId: string,
    sessionId: string,
    closingCount: number,
    notes?: string,
  ) {
    const session = await this.prisma.cafeCashSession.findFirst({
      where: { id: sessionId, organizationId },
    });
    if (!session) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Cash session not found',
      });
    }
    if (session.status !== 'open') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Session is already closed',
      });
    }

    const sales = await this.prisma.cafeOrder.aggregate({
      where: { sessionId, status: 'closed' },
      _sum: { total: true },
    });

    const expected =
      Number(session.openingFloat) + Number(sales._sum.total ?? 0);

    const closed = await this.prisma.cafeCashSession.update({
      where: { id: sessionId },
      data: {
        status: 'closed',
        closedBy: actorId,
        closedAt: new Date(),
        expectedCash: expected,
        closingCount,
        variance: Number((closingCount - expected).toFixed(2)),
        notes: notes ?? null,
      },
    });

    await this.audit.log({
      organizationId,
      branchId: session.branchId,
      actorId,
      action: 'dailycup.session.close',
      entity: 'CafeCashSession',
      entityId: sessionId,
      after: closed,
    });
    return closed;
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  async listOrders(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; status?: string; type?: string },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.CafeOrderWhereInput = {
      organizationId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.cafeOrder.findMany({
        where,
        include: this.orderInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cafeOrder.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toOrderDto(r)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Kitchen display — open orders waiting to be made, oldest first. */
  async kitchenQueue(organizationId: string, branchId: string) {
    const rows = await this.prisma.cafeOrder.findMany({
      where: { organizationId, branchId, status: { in: ['open', 'preparing'] } },
      include: this.orderInclude(),
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toOrderDto(r));
  }

  /**
   * Takes an order, prices it, freezes the ingredient cost of every line and
   * depletes stock. All in one transaction so the drawer and the store agree.
   */
  async createOrder(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      type?: string;
      customerId?: string;
      visitId?: string;
      tableRef?: string;
      discount?: number;
      taxRatePct?: number;
      items: Array<{
        variantId: string;
        qty: number;
        modifierCodes?: string[];
        notes?: string;
      }>;
    },
  ) {
    if (dto.items.length === 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'An order needs at least one item',
      });
    }
    if (dto.type === 'waiting_area' && !dto.visitId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'A waiting-area order must reference the vehicle visit',
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

    const session = await this.prisma.cafeCashSession.findFirst({
      where: { branchId, status: 'open' },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequences.nextInTx(tx, organizationId, 'DC');

      const order = await tx.cafeOrder.create({
        data: {
          organizationId,
          branchId,
          number,
          type: dto.type ?? 'takeaway',
          status: 'open',
          customerId: dto.customerId ?? null,
          visitId: dto.visitId ?? null,
          sessionId: session?.id ?? null,
          tableRef: dto.tableRef ?? null,
          employeeId: actorId,
        },
      });

      let subtotal = 0;
      let costTotal = 0;

      for (const [index, line] of dto.items.entries()) {
        const variant = await tx.cafeProductVariant.findFirst({
          where: { id: line.variantId, product: { organizationId } },
          include: {
            product: true,
            recipe: { include: { items: { include: { part: true } } } },
          },
        });
        if (!variant) {
          throw new NotFoundException({
            code: ErrorCodes.NOT_FOUND,
            message: 'Menu item not found',
          });
        }

        const qty = Number(line.qty);
        if (!(qty > 0)) {
          throw new BadRequestException({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'qty must be greater than 0',
          });
        }

        const modifiers = line.modifierCodes?.length
          ? await tx.cafeModifier.findMany({
              where: {
                organizationId,
                code: { in: line.modifierCodes },
                isActive: true,
              },
            })
          : [];

        const modifierDelta = modifiers.reduce(
          (sum, m) => sum + Number(m.priceDelta),
          0,
        );
        const unitPrice = Number(variant.price) + modifierDelta;
        const lineTotal = qty * unitPrice;
        subtotal += lineTotal;

        // Freeze cost at sale time so historic margins never drift.
        const unitCost = variant.recipe
          ? this.computeRecipeCost(variant.recipe).costPerUnit
          : 0;
        const lineCost = unitCost * qty;
        costTotal += lineCost;

        await tx.cafeOrderItem.create({
          data: {
            orderId: order.id,
            variantId: variant.id,
            nameEn: `${variant.product.nameEn} ${variant.nameEn}`.trim(),
            nameAr: `${variant.product.nameAr} ${variant.nameAr}`.trim(),
            qty,
            unitPrice,
            lineTotal,
            modifiers: modifiers.length
              ? (modifiers.map((m) => ({
                  code: m.code,
                  nameEn: m.nameEn,
                  nameAr: m.nameAr,
                  priceDelta: Number(m.priceDelta),
                })) as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            costSnapshot: Number(lineCost.toFixed(4)),
            notes: line.notes ?? null,
            sortOrder: index,
          },
        });

        // Deplete ingredients for this line and its modifiers.
        await this.depleteIngredients(tx, {
          organizationId,
          branchId,
          warehouseId: warehouse.id,
          actorId,
          orderId: order.id,
          orderNumber: number,
          recipe: variant.recipe,
          modifiers,
          qty,
        });
      }

      const orderDiscount = Number(dto.discount ?? 0);
      const taxable = Math.max(subtotal - orderDiscount, 0);
      const tax = Number((taxable * ((dto.taxRatePct ?? 0) / 100)).toFixed(2));

      return tx.cafeOrder.update({
        where: { id: order.id },
        data: {
          subtotal,
          discount: orderDiscount,
          tax,
          total: taxable + tax,
          costTotal: Number(costTotal.toFixed(4)),
        },
        include: this.orderInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'dailycup.order.create',
      entity: 'CafeOrder',
      entityId: created.id,
      after: created,
    });
    return this.toOrderDto(created);
  }

  async markReady(organizationId: string, orderId: string) {
    const order = await this.findOrderOrFail(organizationId, orderId);
    const updated = await this.prisma.cafeOrder.update({
      where: { id: order.id },
      data: { status: 'ready', readyAt: new Date() },
      include: this.orderInclude(),
    });
    return this.toOrderDto(updated);
  }

  /** Closes the order and raises an invoice in the shared ledger. */
  async closeOrder(
    organizationId: string,
    branchId: string,
    actorId: string,
    orderId: string,
  ) {
    const order = await this.findOrderOrFail(organizationId, orderId);
    if (order.status === 'closed') {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATUS_TRANSITION,
        message: 'Order is already closed',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let invoiceId: string | null = order.invoiceId;

      // Walk-in cash sales have no customer, so no ledger invoice is raised —
      // they are reconciled through the cash session instead.
      if (order.customerId && !invoiceId) {
        const number = await this.sequences.nextInTx(
          tx,
          organizationId,
          'INV',
        );
        const invoice = await tx.invoice.create({
          data: {
            organizationId,
            branchId,
            customerId: order.customerId,
            number,
            sourceApp: 'dailycup',
            sourceRefType: 'dailycup.order',
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
                kind: 'beverage',
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
        invoiceId = invoice.id;
      }

      return tx.cafeOrder.update({
        where: { id: order.id },
        data: { status: 'closed', closedAt: new Date(), invoiceId },
        include: this.orderInclude(),
      });
    });

    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'dailycup.order.close',
      entity: 'CafeOrder',
      entityId: orderId,
      after: updated,
    });
    return this.toOrderDto(updated);
  }

  // ── Waste ──────────────────────────────────────────────────────────────

  async logWaste(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: { partId: string; qty: number; unit: string; reason: string; notes?: string },
  ) {
    const part = await this.prisma.part.findFirst({
      where: { id: dto.partId, organizationId, deletedAt: null },
    });
    if (!part) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Ingredient not found',
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

    const cost = Number(part.costPrice) * dto.qty;

    return this.prisma.$transaction(async (tx) => {
      const log = await tx.cafeWasteLog.create({
        data: {
          organizationId,
          branchId,
          partId: dto.partId,
          qty: dto.qty,
          unit: dto.unit,
          reason: dto.reason,
          cost: Number(cost.toFixed(4)),
          recordedBy: actorId,
          notes: dto.notes ?? null,
        },
      });

      await this.stock.applyMutation(tx, {
        organizationId,
        branchId,
        warehouseId: warehouse.id,
        partId: dto.partId,
        deltaOnHand: -dto.qty,
        deltaReserved: 0,
        type: 'adjustment',
        actorId,
        referenceType: 'dailycup_waste',
        referenceId: log.id,
        notes: `Waste: ${dto.reason}`,
      });

      return log;
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Issues stock for every ingredient a sold item consumes.
   * `requireAvailable` is deliberately omitted: a barista must never be
   * blocked mid-service by a stock count, so this can go negative and surface
   * as a variance in the stock report.
   */
  private async depleteIngredients(
    tx: Tx,
    params: {
      organizationId: string;
      branchId: string;
      warehouseId: string;
      actorId: string;
      orderId: string;
      orderNumber: string;
      recipe: {
        yieldQty: Prisma.Decimal;
        items: Array<{ partId: string; qty: Prisma.Decimal; wastePct: Prisma.Decimal }>;
      } | null;
      modifiers: Array<{ ingredientPartId: string | null; qty: Prisma.Decimal | null }>;
      qty: number;
    },
  ) {
    const draws = new Map<string, number>();

    if (params.recipe) {
      const yieldQty = Number(params.recipe.yieldQty) || 1;
      for (const item of params.recipe.items) {
        const perUnit =
          (Number(item.qty) * (1 + Number(item.wastePct))) / yieldQty;
        draws.set(
          item.partId,
          (draws.get(item.partId) ?? 0) + perUnit * params.qty,
        );
      }
    }

    for (const modifier of params.modifiers) {
      if (!modifier.ingredientPartId || !modifier.qty) continue;
      draws.set(
        modifier.ingredientPartId,
        (draws.get(modifier.ingredientPartId) ?? 0) +
          Number(modifier.qty) * params.qty,
      );
    }

    for (const [partId, amount] of draws) {
      if (amount <= 0) continue;
      await this.stock.applyMutation(tx, {
        organizationId: params.organizationId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        partId,
        deltaOnHand: -Number(amount.toFixed(4)),
        deltaReserved: 0,
        type: 'issue',
        actorId: params.actorId,
        referenceType: 'dailycup_order',
        referenceId: params.orderId,
        notes: `Daily Cup order ${params.orderNumber}`,
      });
    }
  }

  private computeRecipeCost(recipe: {
    yieldQty: Prisma.Decimal;
    items: Array<{
      qty: Prisma.Decimal;
      wastePct: Prisma.Decimal;
      part: { costPrice: Prisma.Decimal };
    }>;
  }) {
    const total = recipe.items.reduce(
      (sum, i) =>
        sum +
        Number(i.qty) * (1 + Number(i.wastePct)) * Number(i.part.costPrice),
      0,
    );
    const yieldQty = Number(recipe.yieldQty) || 1;
    return { totalCost: total, costPerUnit: total / yieldQty };
  }

  private async findOrderOrFail(organizationId: string, id: string) {
    const order = await this.prisma.cafeOrder.findFirst({
      where: { id, organizationId },
      include: this.orderInclude(),
    });
    if (!order) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Order not found',
      });
    }
    return order;
  }

  private orderInclude() {
    return {
      customer: { select: { id: true, nameEn: true, nameAr: true, phone: true } },
      items: { orderBy: { sortOrder: 'asc' as const } },
    };
  }

  private toOrderDto(order: {
    id: string;
    number: string;
    type: string;
    status: string;
    branchId: string;
    customerId: string | null;
    visitId: string | null;
    sessionId: string | null;
    tableRef: string | null;
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
    costTotal: Prisma.Decimal;
    invoiceId: string | null;
    readyAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    customer: { id: string; nameEn: string; nameAr: string; phone: string | null } | null;
    items: Array<{
      id: string;
      variantId: string;
      nameEn: string;
      nameAr: string;
      qty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      modifiers: Prisma.JsonValue;
      costSnapshot: Prisma.Decimal;
      notes: string | null;
      sortOrder: number;
    }>;
  }) {
    const total = Number(order.total);
    const cost = Number(order.costTotal);
    return {
      id: order.id,
      number: order.number,
      type: order.type,
      status: order.status,
      branchId: order.branchId,
      visitId: order.visitId,
      sessionId: order.sessionId,
      tableRef: order.tableRef,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      tax: Number(order.tax),
      total,
      cost,
      grossProfit: Number((total - cost).toFixed(4)),
      invoiceId: order.invoiceId,
      readyAt: order.readyAt,
      closedAt: order.closedAt,
      createdAt: order.createdAt,
      customer: order.customer,
      items: order.items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        nameEn: i.nameEn,
        nameAr: i.nameAr,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        modifiers: i.modifiers,
        cost: Number(i.costSnapshot),
        notes: i.notes,
        sortOrder: i.sortOrder,
      })),
    };
  }
}
