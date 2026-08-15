import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type SequenceMap = Record<
  string,
  { prefix: string; year: number; next: number }
>;

type Tx = Prisma.TransactionClient;

/**
 * OQ-09 default (recommended): per-organization global sequences.
 * Format: PREFIX-YYYY-#### e.g. JT-2026-0001
 */
@Injectable()
export class NumberSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(organizationId: string, key: string): Promise<string> {
    return this.prisma.$transaction((tx) =>
      this.nextInTx(tx, organizationId, key),
    );
  }

  async nextInTx(tx: Tx, organizationId: string, key: string): Promise<string> {
    // Serialize all sequence generators for this org (cross-connection safe)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}::text))`;

    const rows = await tx.$queryRaw<Array<{ id: string; value: unknown }>>`
      SELECT id, value
      FROM core.system_settings
      WHERE organization_id = ${organizationId}::uuid
        AND key = 'number_sequences'
      FOR UPDATE
    `;

    const year = new Date().getFullYear();
    const raw = rows[0]?.value;
    const parsed: SequenceMap =
      typeof raw === 'string'
        ? (JSON.parse(raw) as SequenceMap)
        : ((raw as SequenceMap) ?? {});
    const sequences: SequenceMap = { ...parsed };
    const current = sequences[key] ?? {
      prefix: key,
      year,
      next: 1,
    };

    if (current.year !== year) {
      current.year = year;
      current.next = 1;
    }

    // Skip numbers that already exist (guards against lex-sorted seed drift)
    let number = '';
    for (let attempt = 0; attempt < 50; attempt++) {
      number = `${current.prefix}-${current.year}-${String(current.next).padStart(4, '0')}`;
      current.next += 1;
      const taken = await this.isTaken(tx, organizationId, key, number);
      if (!taken) break;
    }

    sequences[key] = current;

    await tx.systemSetting.upsert({
      where: {
        organizationId_key: {
          organizationId,
          key: 'number_sequences',
        },
      },
      update: { value: sequences },
      create: {
        organizationId,
        key: 'number_sequences',
        value: sequences,
      },
    });

    return number;
  }

  private async isTaken(
    tx: Tx,
    organizationId: string,
    key: string,
    number: string,
  ): Promise<boolean> {
    if (key === 'WO') {
      const row = await tx.workOrder.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'JT') {
      const row = await tx.jobTicket.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'PR') {
      const row = await tx.purchaseRequest.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'PO') {
      const row = await tx.purchaseOrder.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'Q') {
      const row = await tx.quotation.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'INV') {
      const row = await tx.invoice.findFirst({
        where: { organizationId, number },
        select: { id: true },
      });
      return Boolean(row);
    }
    if (key === 'PAY') {
      const row = await tx.payment.findFirst({
        where: { number },
        select: { id: true },
      });
      return Boolean(row);
    }
    return false;
  }
}
