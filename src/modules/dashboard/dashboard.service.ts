import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisCacheService } from '../../infrastructure/cache/redis-cache.service';

/** Locked Active Jobs KPI — workshop floor only (§19 active subset). */
const ACTIVE_JOB_STATUSES = [
  'readyForRepair',
  'inProgress',
  'waitingParts',
  'qualityCheck',
] as const;

/** Dashboard workshop-status chart columns (non-completed board stages). */
const WORKSHOP_STATUS_COLUMNS = [
  'waiting',
  'inspection',
  'waitingApproval',
  'readyForRepair',
  'inProgress',
  'waitingParts',
  'qualityCheck',
  'readyForDelivery',
] as const;

type BranchScope = { mode: 'one'; branchId: string } | { mode: 'all' };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
  ) {}

  async summary(organizationId: string, scope: BranchScope) {
    return this.cached(organizationId, scope, 'summary', () =>
      this.computeSummary(organizationId, scope),
    );
  }

  async revenueOverview(organizationId: string, scope: BranchScope) {
    return this.cached(organizationId, scope, 'revenue-overview', () =>
      this.computeRevenueOverview(organizationId, scope),
    );
  }

  async workshopStatus(organizationId: string, scope: BranchScope) {
    return this.cached(organizationId, scope, 'workshop-status', () =>
      this.computeWorkshopStatus(organizationId, scope),
    );
  }

  async monthlyRevenue(organizationId: string, scope: BranchScope) {
    return this.cached(organizationId, scope, 'monthly-revenue', () =>
      this.computeMonthlyRevenue(organizationId, scope),
    );
  }

  async techProductivity(organizationId: string, scope: BranchScope) {
    return this.cached(organizationId, scope, 'tech-productivity', () =>
      this.computeTechProductivity(organizationId, scope),
    );
  }

  async recentActivities(
    organizationId: string,
    scope: BranchScope,
    limit = 20,
  ) {
    return this.cached(
      organizationId,
      scope,
      `recent-activities:${limit}`,
      () => this.computeRecentActivities(organizationId, scope, limit),
    );
  }

  private async cached<T>(
    organizationId: string,
    scope: BranchScope,
    name: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    const branchKey = scope.mode === 'all' ? 'all' : scope.branchId;
    const key = this.cache.dashKey(organizationId, branchKey, name);
    return this.cache.getOrSetJson(key, factory, 45);
  }

  private async computeSummary(organizationId: string, scope: BranchScope) {
    const todayStart = startOfLocalDay(new Date());
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      vehiclesToday,
      activeJobs,
      inProgressJobs,
      pendingApprovals,
      vehiclesReady,
      revenueToday,
      outstanding,
      lowStock,
      activeTechs,
      totalTechs,
    ] = await Promise.all([
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          deletedAt: null,
          checkedInAt: { gte: todayStart, lt: tomorrow },
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: [...ACTIVE_JOB_STATUSES] },
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: 'inProgress',
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.quotation.count({
        where: {
          organizationId,
          status: 'pending',
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.vehicleVisit.count({
        where: {
          organizationId,
          deletedAt: null,
          status: 'readyForDelivery',
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'confirmed',
          paidAt: { gte: todayStart, lt: tomorrow },
          ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
          invoice: { organizationId },
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
      this.countLowStock(organizationId, scope),
      this.countActiveTechnicians(organizationId, scope),
      this.countTechnicianUsers(organizationId, scope),
    ]);

    const revenue = Number(revenueToday._sum.amount ?? 0);
    const outstandingAmt = Number(outstanding[0]?.outstanding ?? 0);
    const outstandingInvoices = Number(outstanding[0]?.invoices ?? 0);
    const utilization =
      totalTechs > 0 ? Math.round((activeTechs / totalTechs) * 100) : 0;

    return {
      kpis: {
        vehiclesToday: {
          key: 'vehiclesToday',
          labelEn: 'Vehicles Today',
          labelAr: 'مركبات اليوم',
          value: vehiclesToday,
        },
        activeJobs: {
          key: 'activeJobs',
          labelEn: 'Active Jobs',
          labelAr: 'مهام جارية',
          value: activeJobs,
          meta: { inProgress: inProgressJobs },
        },
        pendingApprovals: {
          key: 'pendingApprovals',
          labelEn: 'Pending Approvals',
          labelAr: 'موافقات معلقة',
          value: pendingApprovals,
        },
        vehiclesReady: {
          key: 'vehiclesReady',
          labelEn: 'Vehicles Ready',
          labelAr: 'مركبات جاهزة',
          value: vehiclesReady,
        },
        revenueToday: {
          key: 'revenueToday',
          labelEn: 'Revenue Today',
          labelAr: 'إيرادات اليوم',
          value: revenue,
        },
        outstandingPayments: {
          key: 'outstanding',
          labelEn: 'Outstanding Payments',
          labelAr: 'مبالغ مستحقة',
          value: outstandingAmt,
          meta: { invoiceCount: outstandingInvoices },
        },
        lowStockItems: {
          key: 'lowStock',
          labelEn: 'Low Stock Items',
          labelAr: 'أصناف تحت الحد',
          value: lowStock,
        },
        activeTechnicians: {
          key: 'activeTechs',
          labelEn: 'Active Technicians',
          labelAr: 'فنيون نشطون',
          value: activeTechs,
          meta: { total: totalTechs, utilizationPct: utilization },
          display: `${activeTechs} / ${totalTechs}`,
        },
      },
      generatedAt: new Date().toISOString(),
      scope: scope.mode === 'all' ? 'all' : scope.branchId,
    };
  }

  private async countLowStock(organizationId: string, scope: BranchScope) {
    const openAlerts = await this.prisma.stockAlert.count({
      where: {
        status: 'open',
        ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
        part: { organizationId },
      },
    });
    if (openAlerts > 0) return openAlerts;

    const rows = await this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM inventory.stock_balances sb
      JOIN inventory.parts p ON p.id = sb.part_id
      JOIN inventory.warehouses w ON w.id = sb.warehouse_id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.deleted_at IS NULL
        ${scope.mode === 'one' ? Prisma.sql`AND w.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
        AND (sb.on_hand - sb.reserved) < p.min_stock
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  private async countActiveTechnicians(
    organizationId: string,
    scope: BranchScope,
  ) {
    const rows = await this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(DISTINCT t.assignee_id)::bigint AS cnt
      FROM promotors.technician_tasks t
      JOIN promotors.work_orders wo ON wo.id = t.work_order_id
      WHERE wo.organization_id = ${organizationId}::uuid
        AND t.status = 'in_progress'::promotors."TechnicianTaskStatus"
        AND t.assignee_id IS NOT NULL
        ${scope.mode === 'one' ? Prisma.sql`AND wo.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  private async countTechnicianUsers(
    organizationId: string,
    scope: BranchScope,
  ) {
    const rows = await this.prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(DISTINCT u.id)::bigint AS cnt
      FROM core.users u
      JOIN core.user_roles ur ON ur.user_id = u.id
      JOIN core.roles r ON r.id = ur.role_id
      LEFT JOIN core.user_branch_access ub ON ub.user_id = u.id
      WHERE u.organization_id = ${organizationId}::uuid
        AND u.deleted_at IS NULL
        AND u.status = 'active'::core."UserStatus"
        AND r.key = 'technician'
        ${
          scope.mode === 'one'
            ? Prisma.sql`AND ub.branch_id = ${scope.branchId}::uuid`
            : Prisma.empty
        }
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  private async computeRevenueOverview(
    organizationId: string,
    scope: BranchScope,
  ) {
    const days: Array<{
      day: string;
      date: string;
      revenue: number;
      expenses: number;
    }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const start = startOfLocalDay(d);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const [pay, exp] = await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            status: 'confirmed',
            paidAt: { gte: start, lt: end },
            ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
            invoice: { organizationId },
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            status: 'confirmed',
            expenseDate: { gte: start, lt: end },
            ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
          },
          _sum: { amount: true },
        }),
      ]);

      days.push({
        day: start.toLocaleDateString('en-US', { weekday: 'short' }),
        date: start.toISOString().slice(0, 10),
        revenue: Number(pay._sum.amount ?? 0),
        expenses: Number(exp._sum.amount ?? 0),
      });
    }

    const totalRevenue = days.reduce((s, x) => s + x.revenue, 0);
    return { series: days, totalRevenue, days: 7 };
  }

  private async computeWorkshopStatus(
    organizationId: string,
    scope: BranchScope,
  ) {
    const grouped = await this.prisma.vehicleVisit.groupBy({
      by: ['status'],
      where: {
        organizationId,
        deletedAt: null,
        status: { not: 'completed' },
        ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
      },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(
      grouped.map((g) => [g.status, g._count._all]),
    ) as Record<string, number>;

    const columns = WORKSHOP_STATUS_COLUMNS.map((status) => ({
      status,
      value: byStatus[status] ?? 0,
    }));

    return { columns, total: columns.reduce((s, c) => s + c.value, 0) };
  }

  private async computeMonthlyRevenue(
    organizationId: string,
    scope: BranchScope,
  ) {
    const months: Array<{ month: string; yearMonth: string; value: number }> =
      [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
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
      months.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        yearMonth: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        value: Number(pay._sum.amount ?? 0),
      });
    }
    return { series: months };
  }

  private async computeTechProductivity(
    organizationId: string,
    scope: BranchScope,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        name_en: string;
        name_ar: string;
        jobs: bigint;
        completed: bigint;
        avg_minutes: number | null;
      }>
    >`
      SELECT
        u.id AS user_id,
        COALESCE(e.name_en, u.email, u.username, 'Technician') AS name_en,
        COALESCE(e.name_ar, u.email, u.username, 'فني') AS name_ar,
        COUNT(wo.id)::bigint AS jobs,
        COUNT(wo.id) FILTER (WHERE wo.status = 'completed'::promotors."WorkOrderStatus")::bigint AS completed,
        AVG(wo.actual_minutes)::float AS avg_minutes
      FROM core.users u
      JOIN core.user_roles ur ON ur.user_id = u.id
      JOIN core.roles r ON r.id = ur.role_id AND r.key = 'technician'
      LEFT JOIN core.employees e ON e.id = u.employee_id
      LEFT JOIN promotors.work_orders wo
        ON wo.technician_id = u.id
        AND wo.organization_id = ${organizationId}::uuid
        ${scope.mode === 'one' ? Prisma.sql`AND wo.branch_id = ${scope.branchId}::uuid` : Prisma.empty}
        AND wo.created_at >= NOW() - INTERVAL '30 days'
      WHERE u.organization_id = ${organizationId}::uuid
        AND u.deleted_at IS NULL
        AND u.status = 'active'::core."UserStatus"
      GROUP BY u.id, e.name_en, e.name_ar, u.email, u.username
      ORDER BY jobs DESC, name_en ASC
      LIMIT 20
    `;

    return {
      technicians: rows.map((r) => ({
        userId: r.user_id,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        jobs: Number(r.jobs),
        completed: Number(r.completed),
        avgMinutes: r.avg_minutes != null ? Math.round(r.avg_minutes) : null,
      })),
      windowDays: 30,
    };
  }

  private async computeRecentActivities(
    organizationId: string,
    scope: BranchScope,
    limit: number,
  ) {
    const take = Math.min(50, Math.max(1, limit));
    const logs = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(scope.mode === 'one' ? { branchId: scope.branchId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        actorId: true,
        branchId: true,
        createdAt: true,
        metadata: true,
      },
    });

    const actorIds = [
      ...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[]),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { nameEn: true, nameAr: true } },
          },
        })
      : [];
    const actorMap = new Map(
      actors.map((a) => [
        a.id,
        {
          id: a.id,
          nameEn: a.employee?.nameEn ?? a.email ?? null,
          nameAr: a.employee?.nameAr ?? a.email ?? null,
        },
      ]),
    );

    return {
      items: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        branchId: l.branchId,
        createdAt: l.createdAt,
        actor: l.actorId ? (actorMap.get(l.actorId) ?? null) : null,
      })),
    };
  }
}

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
