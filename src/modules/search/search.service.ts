import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { normalizePlate } from '../../common/utils/plate.util';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(organizationId: string, q: string, limit = 8) {
    const term = q.trim();
    if (term.length < 2) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Search query must be at least 2 characters',
      });
    }

    const take = Math.min(20, Math.max(1, limit));
    const like = `%${term}%`;
    const plateNorm = normalizePlate(term);

    const [customers, vehicles] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          name_en: string;
          name_ar: string;
          phone: string;
          status: string;
        }>
      >(Prisma.sql`
        SELECT id, name_en, name_ar, phone, status::text AS status
        FROM core.customers
        WHERE organization_id = ${organizationId}::uuid
          AND deleted_at IS NULL
          AND (
            name_en ILIKE ${like}
            OR name_ar ILIKE ${like}
            OR phone ILIKE ${like}
            OR similarity(name_en, ${term}) > 0.2
            OR similarity(name_ar, ${term}) > 0.2
          )
        ORDER BY
          GREATEST(
            similarity(name_en, ${term}),
            similarity(name_ar, ${term}),
            similarity(phone, ${term})
          ) DESC,
          name_en ASC
        LIMIT ${take}
      `),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          plate: string;
          vin: string | null;
          make: string;
          model: string;
          year: number;
          customer_id: string;
          customer_name_en: string;
          customer_name_ar: string;
        }>
      >(Prisma.sql`
        SELECT
          v.id,
          v.plate,
          v.vin,
          v.make,
          v.model,
          v.year,
          v.customer_id,
          c.name_en AS customer_name_en,
          c.name_ar AS customer_name_ar
        FROM promotors.vehicles v
        JOIN core.customers c ON c.id = v.customer_id
        WHERE v.organization_id = ${organizationId}::uuid
          AND v.deleted_at IS NULL
          AND (
            v.plate ILIKE ${like}
            OR v.plate_normalized ILIKE ${'%' + plateNorm + '%'}
            OR COALESCE(v.vin, '') ILIKE ${like}
            OR similarity(v.plate_normalized, ${plateNorm}) > 0.2
            OR similarity(COALESCE(v.vin, ''), ${term}) > 0.2
          )
        ORDER BY
          GREATEST(
            similarity(v.plate_normalized, ${plateNorm}),
            similarity(COALESCE(v.vin, ''), ${term})
          ) DESC,
          v.plate ASC
        LIMIT ${take}
      `),
    ]);

    return {
      customers: customers.map((c) => ({
        id: c.id,
        nameEn: c.name_en,
        nameAr: c.name_ar,
        phone: c.phone,
        status: c.status,
        type: 'customer' as const,
      })),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        vin: v.vin,
        make: v.make,
        model: v.model,
        year: v.year,
        customerId: v.customer_id,
        customerNameEn: v.customer_name_en,
        customerNameAr: v.customer_name_ar,
        type: 'vehicle' as const,
      })),
      // Populated in later phases
      tickets: [] as unknown[],
      invoices: [] as unknown[],
      quotations: [] as unknown[],
      parts: [] as unknown[],
    };
  }
}
