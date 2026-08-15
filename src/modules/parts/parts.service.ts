import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';

@Injectable()
export class PartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; q?: string; active?: boolean },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.PartWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(query.q
        ? {
            OR: [
              { sku: { contains: query.q, mode: 'insensitive' } },
              { nameEn: { contains: query.q, mode: 'insensitive' } },
              { nameAr: { contains: query.q, mode: 'insensitive' } },
              { barcode: { contains: query.q, mode: 'insensitive' } },
              { oemNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const warehouseIds = (
      await this.prisma.warehouse.findMany({
        where: { branchId },
        select: { id: true },
      })
    ).map((w) => w.id);

    const [total, rows] = await Promise.all([
      this.prisma.part.count({ where }),
      this.prisma.part.findMany({
        where,
        orderBy: { sku: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: true,
          balances: { where: { warehouseId: { in: warehouseIds } } },
        },
      }),
    ]);

    return {
      data: rows.map((p) => {
        const onHand = p.balances.reduce((s, b) => s + Number(b.onHand), 0);
        const reserved = p.balances.reduce((s, b) => s + Number(b.reserved), 0);
        const available = onHand - reserved;
        let status: 'ok' | 'low' | 'out' = 'ok';
        if (available <= 0) status = 'out';
        else if (available < p.minStock) status = 'low';
        const loc = p.balances[0]?.binLocation ?? null;
        return {
          id: p.id,
          no: p.sku,
          sku: p.sku,
          barcode: p.barcode,
          oemNumber: p.oemNumber,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          en: p.nameEn,
          ar: p.nameAr,
          cat: p.category?.nameEn ?? null,
          catAr: p.category?.nameAr ?? null,
          brand: p.brand,
          unit: p.unit,
          buy: Number(p.costPrice),
          sell: Number(p.sellPrice),
          costPrice: Number(p.costPrice),
          sellPrice: Number(p.sellPrice),
          min: p.minStock,
          max: p.maxStock,
          available,
          reserved,
          onHand,
          loc,
          status,
          isActive: p.isActive,
          branch: branchId,
        };
      }),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async getById(organizationId: string, branchId: string, id: string) {
    const p = await this.prisma.part.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        category: true,
        balances: {
          where: {
            warehouse: { branchId },
          },
          include: { warehouse: true },
        },
      },
    });
    if (!p) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Part not found',
      });
    }
    const onHand = p.balances.reduce((s, b) => s + Number(b.onHand), 0);
    const reserved = p.balances.reduce((s, b) => s + Number(b.reserved), 0);
    return {
      id: p.id,
      sku: p.sku,
      no: p.sku,
      barcode: p.barcode,
      oemNumber: p.oemNumber,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      brand: p.brand,
      unit: p.unit,
      costPrice: Number(p.costPrice),
      sellPrice: Number(p.sellPrice),
      minStock: p.minStock,
      maxStock: p.maxStock,
      isActive: p.isActive,
      categoryId: p.categoryId,
      cat: p.category?.nameEn ?? null,
      catAr: p.category?.nameAr ?? null,
      onHand,
      reserved,
      available: onHand - reserved,
      balances: p.balances.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        onHand: Number(b.onHand),
        reserved: Number(b.reserved),
        available: this.stock.available(b.onHand, b.reserved),
        loc: b.binLocation,
        version: b.version,
      })),
    };
  }

  async create(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      sku: string;
      nameEn: string;
      nameAr: string;
      costPrice: number;
      sellPrice: number;
      barcode?: string;
      oemNumber?: string;
      brand?: string;
      unit?: string;
      minStock?: number;
      maxStock?: number;
      categoryId?: string;
      initialQty?: number;
      binLocation?: string;
    },
  ) {
    if (!dto.sku?.trim()) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'sku is required',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const part = await tx.part.create({
        data: {
          organizationId,
          sku: dto.sku.trim(),
          nameEn: dto.nameEn,
          nameAr: dto.nameAr,
          costPrice: dto.costPrice,
          sellPrice: dto.sellPrice,
          barcode: dto.barcode,
          oemNumber: dto.oemNumber,
          brand: dto.brand,
          unit: dto.unit ?? 'pcs',
          minStock: dto.minStock ?? 0,
          maxStock: dto.maxStock,
          categoryId: dto.categoryId,
        },
      });

      const warehouse = await tx.warehouse.findFirst({
        where: { branchId, isDefault: true },
      });
      if (warehouse) {
        await tx.stockBalance.create({
          data: {
            warehouseId: warehouse.id,
            partId: part.id,
            onHand: dto.initialQty ?? 0,
            reserved: 0,
            binLocation: dto.binLocation,
          },
        });
        if (dto.initialQty && dto.initialQty > 0) {
          await tx.inventoryTransaction.create({
            data: {
              organizationId,
              branchId,
              warehouseId: warehouse.id,
              partId: part.id,
              type: 'adjustment',
              qty: dto.initialQty,
              unitCost: dto.costPrice,
              notes: 'Initial stock',
              createdBy: actorId,
            },
          });
        }
      }
      return part;
    });

    const result = await this.getById(organizationId, branchId, created.id);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'part.create',
      entity: 'Part',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  async update(
    organizationId: string,
    branchId: string,
    actorId: string,
    id: string,
    dto: Partial<{
      nameEn: string;
      nameAr: string;
      costPrice: number;
      sellPrice: number;
      barcode: string;
      oemNumber: string;
      brand: string;
      unit: string;
      minStock: number;
      maxStock: number | null;
      categoryId: string | null;
      isActive: boolean;
    }>,
  ) {
    const existing = await this.prisma.part.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Part not found',
      });
    }

    await this.prisma.part.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: dto.costPrice } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.oemNumber !== undefined ? { oemNumber: dto.oemNumber } : {}),
        ...(dto.brand !== undefined ? { brand: dto.brand } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.minStock !== undefined ? { minStock: dto.minStock } : {}),
        ...(dto.maxStock !== undefined ? { maxStock: dto.maxStock } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    const result = await this.getById(organizationId, branchId, id);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'part.update',
      entity: 'Part',
      entityId: id,
      after: result,
    });
    return result;
  }
}
