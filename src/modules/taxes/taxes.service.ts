import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TaxesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const rows = await this.prisma.taxRate.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { effectiveFrom: 'desc' }],
    });
    return {
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        rate: Number(t.rate),
        isDefault: t.isDefault,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
      })),
      meta: { total: rows.length },
    };
  }

  async defaultRatePct(organizationId: string): Promise<number> {
    const row = await this.prisma.taxRate.findFirst({
      where: { organizationId, isDefault: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? Number(row.rate) : 14;
  }
}
