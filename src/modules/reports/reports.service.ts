import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisCacheService } from '../../infrastructure/cache/redis-cache.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { QUEUE_REPORT_EXPORT } from '../../infrastructure/jobs/jobs.processors';

export type ReportKind =
  | 'workshop'
  | 'financial'
  | 'inventory'
  | 'technician-performance'
  | 'analytics';

export type ReportFormat = 'csv' | 'pdf';

type BranchScope = { mode: 'one'; branchId: string } | { mode: 'all' };

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    @InjectQueue(QUEUE_REPORT_EXPORT) private readonly exportQueue: Queue,
  ) {}

  async workshop(
    organizationId: string,
    scope: BranchScope,
    from?: Date,
    to?: Date,
  ) {
    const range = resolveRange(from, to, 30);
    const branchFilter =
      scope.mode === 'one' ? { branchId: scope.branchId } : {};

    const [
      workOrders,
      completed,
      qcPassed,
      qcFailed,
      deliveredOnTime,
      delivered,
    ] = await Promise.all([
      this.prisma.workOrder.count({
        where: {
          organizationId,
          createdAt: { gte: range.from, lt: range.to },
          ...branchFilter,
        },
      }),
      this.prisma.workOrder.findMany({
        where: {
          organizationId,
          status: 'completed',
          completedAt: { gte: range.from, lt: range.to },
          ...branchFilter,
        },
        select: { actualMinutes: true, estimatedMinutes: true },
      }),
      this.prisma.qualityCheck.count({
        where: {
          status: 'passed',
          createdAt: { gte: range.from, lt: range.to },
          workOrder: { organizationId, ...branchFilter },
        },
      }),
      this.prisma.qualityCheck.count({
        where: {
          status: 'failed',
          createdAt: { gte: range.from, lt: range.to },
          workOrder: { organizationId, ...branchFilter },
        },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          status: 'completed',
          completedAt: { gte: range.from, lt: range.to },
          deletedAt: null,
          ...branchFilter,
          AND: [
            { expectedDeliveryAt: { not: null } },
            {
              deliveredAt: { not: null },
            },
          ],
        },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          status: 'completed',
          completedAt: { gte: range.from, lt: range.to },
          deletedAt: null,
          ...branchFilter,
        },
      }),
    ]);

    // On-time: deliveredAt <= expectedDeliveryAt
    const onTimeRows = await this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM promotors.vehicle_visits
      WHERE organization_id = ${organizationId}::uuid
        AND deleted_at IS NULL
        AND status = 'completed'::promotors."VisitStatus"
        AND completed_at >= ${range.from}
        AND completed_at < ${range.to}
        AND expected_delivery_at IS NOT NULL
        AND delivered_at IS NOT NULL
        AND delivered_at <= expected_delivery_at
        ${scope.mode === 'one' ? Prisma.sql`AND branch_id = ${scope.branchId}::uuid` : Prisma.empty}
    `;

    const avgMinutes =
      completed.length === 0
        ? 0
        : Math.round(
            completed.reduce((s, w) => s + (w.actualMinutes ?? 0), 0) /
              completed.length,
          );
    const qcTotal = qcPassed + qcFailed;
    const reworkRate =
      qcTotal === 0 ? 0 : Math.round((qcFailed / qcTotal) * 1000) / 10;
    const onTimePct =
      delivered === 0
        ? 0
        : Math.round((Number(onTimeRows[0]?.cnt ?? 0) / delivered) * 1000) / 10;

    void deliveredOnTime;

    return {
      range,
      kpis: {
        workOrders,
        avgRepairMinutes: avgMinutes,
        onTimeDeliveryPct: onTimePct,
        reworkRatePct: reworkRate,
        qualityPassRatePct:
          qcTotal === 0 ? 0 : Math.round((qcPassed / qcTotal) * 1000) / 10,
      },
      series: await this.monthlyCompletedSeries(organizationId, scope, 6),
    };
  }

  async financial(
    organizationId: string,
    scope: BranchScope,
    from?: Date,
    to?: Date,
  ) {
    const range = resolveRange(from, to, 30);
    const branchFilter =
      scope.mode === 'one' ? { branchId: scope.branchId } : {};

    const [payments, expenses, outstanding] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          status: 'confirmed',
          paidAt: { gte: range.from, lt: range.to },
          ...branchFilter,
          invoice: { organizationId },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          status: 'confirmed',
          expenseDate: { gte: range.from, lt: range.to },
          ...branchFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<
        Array<{ outstanding: Prisma.Decimal; invoices: bigint }>
      >`
        SELECT
          COALESCE(SUM(total - amount_paid), 0) AS outstanding,
          COUNT(*)::bigint AS invoices
        FROM finance.invoices
        WHERE organization_id = ${organizationId}::uuid
          AND status IN ('issued'::finance."InvoiceStatus", 'partial'::finance."InvoiceStatus")
          ${scope.mode === 'one' ? Prisma.sql`AND branch_id = ${scope.branchId}::uuid` : Prisma.empty}
      `,
    ]);

    const revenue = Number(payments._sum.amount ?? 0);
    const expenseAmt = Number(expenses._sum.amount ?? 0);

    return {
      range,
      kpis: {
        revenue,
        expenses: expenseAmt,
        netProfit: revenue - expenseAmt,
        outstanding: Number(outstanding[0]?.outstanding ?? 0),
        outstandingInvoices: Number(outstanding[0]?.invoices ?? 0),
      },
      series: await this.monthlyPaymentSeries(organizationId, scope, 6),
    };
  }

  async inventory(organizationId: string, scope: BranchScope) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        part_id: string;
        sku: string;
        name_en: string;
        name_ar: string;
        on_hand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        min_stock: Prisma.Decimal;
        warehouse_name: string;
      }>
    >`
      SELECT
        p.id AS part_id,
        p.sku,
        p.name_en,
        p.name_ar,
        sb.on_hand,
        sb.reserved,
        p.min_stock,
        w.name_en AS warehouse_name
      FROM inventory.stock_balances sb
      JOIN inventory.parts p ON p.id = sb.part_id
      JOIN inventory.warehouses w ON w.id = sb.warehouse_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.deleted_at IS NULL
        ${scope.mode === 'one' ? Prisma.sql`AND w.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
      ORDER BY (sb.on_hand - sb.reserved) ASC
      LIMIT 200
    `;

    const openAlerts = await this.prisma.stockAlert.count({
      where: {
        status: 'open',
        ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        part: { organizationId },
      },
    });

    const items = rows.map((r) => {
      const onHand = Number(r.on_hand);
      const reserved = Number(r.reserved);
      const available = onHand - reserved;
      const minStock = Number(r.min_stock);
      return {
        partId: r.part_id,
        sku: r.sku,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        warehouse: r.warehouse_name,
        onHand,
        reserved,
        available,
        minStock,
        low: available < minStock,
      };
    });

    const stockValueRows = await this.prisma.$queryRaw<
      Array<{ value: Prisma.Decimal }>
    >`
      SELECT COALESCE(SUM(sb.on_hand * COALESCE(p.cost_price, 0)), 0) AS value
      FROM inventory.stock_balances sb
      JOIN inventory.parts p ON p.id = sb.part_id
      JOIN inventory.warehouses w ON w.id = sb.warehouse_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.deleted_at IS NULL
        ${scope.mode === 'one' ? Prisma.sql`AND w.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
    `;

    return {
      kpis: {
        skusTracked: items.length,
        lowStockItems: items.filter((i) => i.low).length,
        openAlerts,
        stockValue: Number(stockValueRows[0]?.value ?? 0),
      },
      items,
    };
  }

  async technicianPerformance(
    organizationId: string,
    scope: BranchScope,
    from?: Date,
    to?: Date,
  ) {
    const range = resolveRange(from, to, 30);
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        name_en: string;
        name_ar: string;
        jobs: bigint;
        completed: bigint;
        avg_minutes: number | null;
        qc_pass: bigint;
        qc_fail: bigint;
      }>
    >`
      SELECT
        u.id AS user_id,
        COALESCE(e.name_en, u.email, 'Technician') AS name_en,
        COALESCE(e.name_ar, u.email, 'فني') AS name_ar,
        COUNT(DISTINCT wo.id)::bigint AS jobs,
        COUNT(DISTINCT wo.id) FILTER (WHERE wo.status = 'completed'::promotors."WorkOrderStatus")::bigint AS completed,
        AVG(wo.actual_minutes)::float AS avg_minutes,
        COUNT(qc.id) FILTER (WHERE qc.status = 'passed'::promotors."QualityCheckStatus")::bigint AS qc_pass,
        COUNT(qc.id) FILTER (WHERE qc.status = 'failed'::promotors."QualityCheckStatus")::bigint AS qc_fail
      FROM core.users u
      JOIN core.user_roles ur ON ur.user_id = u.id
      JOIN core.roles r ON r.id = ur.role_id AND r.key = 'technician'
      LEFT JOIN core.employees e ON e.id = u.employee_id
      LEFT JOIN promotors.work_orders wo
        ON wo.technician_id = u.id
        AND wo.organization_id = ${organizationId}::uuid
        AND wo.created_at >= ${range.from}
        AND wo.created_at < ${range.to}
        ${scope.mode === 'one' ? Prisma.sql`AND wo.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
      LEFT JOIN promotors.quality_checks qc ON qc.work_order_id = wo.id
      WHERE u.organization_id = ${organizationId}::uuid
        AND u.deleted_at IS NULL
        AND u.status = 'active'::core."UserStatus"
      GROUP BY u.id, e.name_en, e.name_ar, u.email
      ORDER BY completed DESC, jobs DESC
    `;

    return {
      range,
      technicians: rows.map((r) => {
        const qcTotal = Number(r.qc_pass) + Number(r.qc_fail);
        return {
          userId: r.user_id,
          nameEn: r.name_en,
          nameAr: r.name_ar,
          jobs: Number(r.jobs),
          completed: Number(r.completed),
          avgMinutes: r.avg_minutes != null ? Math.round(r.avg_minutes) : null,
          passRatePct:
            qcTotal === 0
              ? null
              : Math.round((Number(r.qc_pass) / qcTotal) * 1000) / 10,
          reworkPct:
            qcTotal === 0
              ? null
              : Math.round((Number(r.qc_fail) / qcTotal) * 1000) / 10,
        };
      }),
    };
  }

  async analytics(organizationId: string, scope: BranchScope) {
    const [workshop, financial, inventory] = await Promise.all([
      this.workshop(organizationId, scope),
      this.financial(organizationId, scope),
      this.inventory(organizationId, scope),
    ]);
    return {
      workshop: workshop.kpis,
      financial: financial.kpis,
      inventory: {
        lowStockItems: inventory.kpis.lowStockItems,
        stockValue: inventory.kpis.stockValue,
        openAlerts: inventory.kpis.openAlerts,
      },
    };
  }

  async enqueueExport(params: {
    organizationId: string;
    branchId: string;
    scope: BranchScope;
    kind: ReportKind;
    format: ReportFormat;
    requestedBy: string;
    from?: string;
    to?: string;
  }) {
    const job = await this.exportQueue.add(
      'export',
      {
        organizationId: params.organizationId,
        branchId: params.branchId,
        scope: params.scope,
        kind: params.kind,
        format: params.format,
        requestedBy: params.requestedBy,
        from: params.from ?? null,
        to: params.to ?? null,
      },
      {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 2,
      },
    );

    await this.cache.setJson(
      this.cache.reportKey(String(job.id)),
      {
        jobId: String(job.id),
        status: 'queued',
        kind: params.kind,
        format: params.format,
      },
      3600,
    );

    return { jobId: String(job.id), status: 'queued' as const };
  }

  async getExport(jobId: string) {
    const data = await this.cache.getJson<{
      jobId: string;
      status: string;
      kind?: string;
      format?: string;
      contentBase64?: string;
      filename?: string;
      mime?: string;
      error?: string;
    }>(this.cache.reportKey(jobId));
    if (!data) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Export job not found or expired',
      });
    }
    return data;
  }

  async buildExportPayload(params: {
    organizationId: string;
    scope: BranchScope;
    kind: ReportKind;
    from?: string | null;
    to?: string | null;
  }) {
    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;
    switch (params.kind) {
      case 'workshop':
        return this.workshop(params.organizationId, params.scope, from, to);
      case 'financial':
        return this.financial(params.organizationId, params.scope, from, to);
      case 'inventory':
        return this.inventory(params.organizationId, params.scope);
      case 'technician-performance':
        return this.technicianPerformance(
          params.organizationId,
          params.scope,
          from,
          to,
        );
      case 'analytics':
        return this.analytics(params.organizationId, params.scope);
      default:
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Unknown report kind',
        });
    }
  }

  private async monthlyPaymentSeries(
    organizationId: string,
    scope: BranchScope,
    monthsCount: number,
  ) {
    const series: Array<{ month: string; yearMonth: string; value: number }> =
      [];
    const now = new Date();
    for (let i = monthsCount - 1; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const pay = await this.prisma.payment.aggregate({
        where: {
          status: 'confirmed',
          paidAt: { gte: start, lt: end },
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
          invoice: { organizationId },
        },
        _sum: { amount: true },
      });
      series.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        yearMonth: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        value: Number(pay._sum.amount ?? 0),
      });
    }
    return series;
  }

  private async monthlyCompletedSeries(
    organizationId: string,
    scope: BranchScope,
    monthsCount: number,
  ) {
    const series: Array<{ month: string; yearMonth: string; value: number }> =
      [];
    const now = new Date();
    for (let i = monthsCount - 1; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await this.prisma.workOrder.count({
        where: {
          organizationId,
          status: 'completed',
          completedAt: { gte: start, lt: end },
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      });
      series.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        yearMonth: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        value: count,
      });
    }
    return series;
  }
}

function resolveRange(from?: Date, to?: Date, defaultDays = 30) {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - defaultDays * 24 * 3600_000);
  return { from: start, to: end };
}
