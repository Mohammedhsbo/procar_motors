/**
 * Prisma seed — Pro Motors demo data aligned with frontend mock-data.
 * Password for all demo users: Password123!
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const RESOURCES = [
  'users',
  'customers',
  'vehicles',
  'visits',
  'tickets',
  'inspections',
  'work_orders',
  'inventory',
  'parts',
  'reservations',
  'purchasing',
  'purchase_requests',
  'purchase_orders',
  'suppliers',
  'goods_receipts',
  'quotations',
  'invoices',
  'payments',
  'expenses',
  'taxes',
  'reports',
  'settings',
  'audit',
  'board',
  'qc',
  'tasks',
  'services',
  'branches',
  'roles',
  'notifications',
  'dashboard',
  'portal',
] as const;

const ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'assign',
  'complete',
  'cancel',
  'receive',
  'reserve',
  'release',
  'transfer',
  'consume',
  'refund',
  'export',
  'send',
  'manage',
  'move',
] as const;

const ROLES: { key: string; nameEn: string; nameAr: string }[] = [
  { key: 'super_admin', nameEn: 'Super Admin', nameAr: 'مدير النظام الأعلى' },
  { key: 'branch_admin', nameEn: 'Branch Admin', nameAr: 'مدير الفرع' },
  { key: 'reception', nameEn: 'Reception', nameAr: 'الاستقبال' },
  { key: 'advisor', nameEn: 'Service Advisor', nameAr: 'مستشار الخدمة' },
  { key: 'workshop_manager', nameEn: 'Workshop Manager', nameAr: 'مدير الورشة' },
  { key: 'technician', nameEn: 'Technician', nameAr: 'فني' },
  { key: 'quality_controller', nameEn: 'Quality Controller', nameAr: 'مراقب الجودة' },
  { key: 'store_keeper', nameEn: 'Store Keeper', nameAr: 'أمين المخزن' },
  { key: 'warehouse_manager', nameEn: 'Warehouse Manager', nameAr: 'مدير المخزن' },
  { key: 'purchasing_officer', nameEn: 'Purchasing Officer', nameAr: 'مسؤول المشتريات' },
  { key: 'purchasing_manager', nameEn: 'Purchasing Manager', nameAr: 'مدير المشتريات' },
  { key: 'accountant', nameEn: 'Accountant', nameAr: 'المحاسب' },
  { key: 'finance_manager', nameEn: 'Finance Manager', nameAr: 'مدير المالية' },
  { key: 'customer', nameEn: 'Customer', nameAr: 'عميل' },
];

/** Map frontend demo role keys → backend role keys */
const DEMO_USERS: {
  email: string;
  nameEn: string;
  nameAr: string;
  roleKey: string;
  branchCode: string;
  phone: string;
}[] = [
  {
    email: 'superadmin@promotors.eg',
    nameEn: 'Super Admin',
    nameAr: 'مدير النظام الأعلى',
    roleKey: 'super_admin',
    branchCode: 'b1',
    phone: '+20 100 111 2233',
  },
  {
    email: 'admin@promotors.eg',
    nameEn: 'Branch Admin',
    nameAr: 'مدير الفرع',
    roleKey: 'branch_admin',
    branchCode: 'b1',
    phone: '+20 122 334 5566',
  },
  {
    email: 'reception@promotors.eg',
    nameEn: 'Reception',
    nameAr: 'الاستقبال',
    roleKey: 'reception',
    branchCode: 'b1',
    phone: '+20 111 220 8877',
  },
];

async function main() {
  const passwordHash = await argon2.hash('Password123!');

  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      nameEn: 'Pro Motors',
      nameAr: 'برو موتورز',
      taxId: '512-884-337',
      phone: '+20 2 2480 1122',
      email: 'info@promotors.eg',
      status: 'active',
    },
  });

  const branchDefs = [
    { id: '00000000-0000-4000-8000-0000000000b1', code: 'b1', nameEn: 'Nasr City', nameAr: 'مدينة نصر' },
    { id: '00000000-0000-4000-8000-0000000000b2', code: 'b2', nameEn: '6th of October', nameAr: 'السادس من أكتوبر' },
    { id: '00000000-0000-4000-8000-0000000000b3', code: 'b3', nameEn: 'Alexandria', nameAr: 'الإسكندرية' },
  ];

  const branches: Record<string, string> = {};
  for (const b of branchDefs) {
    const row = await prisma.branch.upsert({
      where: { organizationId_code: { organizationId: org.id, code: b.code } },
      update: { nameEn: b.nameEn, nameAr: b.nameAr },
      create: {
        id: b.id,
        organizationId: org.id,
        code: b.code,
        nameEn: b.nameEn,
        nameAr: b.nameAr,
        isActive: true,
      },
    });
    branches[b.code] = row.id;
  }

  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      const key = `${resource}.${action}`;
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, resource, action, description: `${action} ${resource}` },
      });
    }
  }

  // Phase 15 — domain-specific report permissions (not in generic ACTIONS)
  for (const extra of [
    {
      key: 'reports.workshop',
      resource: 'reports',
      action: 'workshop',
      description: 'workshop reports',
    },
    {
      key: 'reports.inventory',
      resource: 'reports',
      action: 'inventory',
      description: 'inventory reports',
    },
    {
      key: 'reports.finance',
      resource: 'reports',
      action: 'finance',
      description: 'financial reports',
    },
  ] as const) {
    await prisma.permission.upsert({
      where: { key: extra.key },
      update: {},
      create: {
        key: extra.key,
        resource: extra.resource,
        action: extra.action,
        description: extra.description,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const roleIds: Record<string, string> = {};

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: r.key } },
      update: { nameEn: r.nameEn, nameAr: r.nameAr },
      create: {
        organizationId: org.id,
        key: r.key,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        isSystem: true,
      },
    });
    roleIds[r.key] = role.id;
  }

  // Super admin gets all permissions
  const superAdminId = roleIds.super_admin!;
  for (const p of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: superAdminId, permissionId: p.id },
      },
      update: {},
      create: { roleId: superAdminId, permissionId: p.id },
    });
  }

  // Reception baseline permissions (inspections: view only)
  const receptionPerms = allPermissions.filter((p) => {
    if (p.resource === 'inspections') return p.action === 'view';
    if (p.resource === 'board' && ['view', 'move'].includes(p.action)) return true;
    return (
      [
        'customers',
        'vehicles',
        'visits',
        'tickets',
        'dashboard',
        'notifications',
      ].includes(p.resource) && ['view', 'create', 'update'].includes(p.action)
    );
  });
  for (const p of receptionPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.reception!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.reception!, permissionId: p.id },
    });
  }

  // Advisor: inspections + visit update + quotations lifecycle + WO view
  const advisorPerms = allPermissions.filter(
    (p) =>
      (['inspections', 'visits', 'customers', 'vehicles', 'tickets'].includes(
        p.resource,
      ) &&
        ['view', 'create', 'update', 'complete', 'assign'].includes(p.action)) ||
      (p.resource === 'quotations' &&
        ['view', 'create', 'update', 'send', 'approve', 'reject'].includes(
          p.action,
        )) ||
      (p.resource === 'work_orders' && p.action === 'view') ||
      (p.resource === 'board' && p.action === 'view') ||
      (p.resource === 'dashboard' && p.action === 'view'),
  );
  for (const p of advisorPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.advisor!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.advisor!, permissionId: p.id },
    });
  }

  // Workshop manager: full work orders + visits/board + QC
  const workshopManagerPerms = allPermissions.filter(
    (p) =>
      (p.resource === 'work_orders' &&
        [
          'view',
          'create',
          'update',
          'assign',
          'complete',
          'cancel',
        ].includes(p.action)) ||
      (['visits', 'tickets', 'tasks', 'board'].includes(p.resource) &&
        ['view', 'update', 'assign', 'complete', 'create', 'move'].includes(
          p.action,
        )) ||
      (p.resource === 'qc' &&
        ['view', 'create', 'update', 'approve', 'reject'].includes(p.action)) ||
      (p.resource === 'dashboard' && p.action === 'view') ||
      (p.resource === 'reports' &&
        ['view', 'workshop', 'export'].includes(p.action)),
  );
  for (const p of workshopManagerPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.workshop_manager!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.workshop_manager!, permissionId: p.id },
    });
  }

  // Technician: view + start/pause/complete (update/complete) + create additional issues
  const technicianPerms = allPermissions.filter(
    (p) =>
      (p.resource === 'work_orders' &&
        ['view', 'update', 'complete'].includes(p.action)) ||
      (p.resource === 'tasks' &&
        ['view', 'update', 'complete', 'create'].includes(p.action)) ||
      (p.resource === 'visits' && p.action === 'view') ||
      (p.resource === 'board' && p.action === 'view') ||
      (p.resource === 'dashboard' && p.action === 'view'),
  );
  for (const p of technicianPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.technician!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.technician!, permissionId: p.id },
    });
  }

  // Quality controller: QC lifecycle + visit/board view
  const qcPerms = allPermissions.filter(
    (p) =>
      (p.resource === 'qc' &&
        ['view', 'create', 'update', 'approve', 'reject'].includes(p.action)) ||
      (['visits', 'work_orders', 'board'].includes(p.resource) &&
        p.action === 'view') ||
      (p.resource === 'dashboard' && p.action === 'view'),
  );
  for (const p of qcPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.quality_controller!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.quality_controller!, permissionId: p.id },
    });
  }

  // Store keeper: full inventory + parts + reservations + goods receive
  const storeKeeperPerms = allPermissions.filter(
    (p) =>
      (['inventory', 'parts', 'reservations'].includes(p.resource) &&
        [
          'view',
          'create',
          'update',
          'manage',
          'transfer',
          'release',
          'consume',
          'reserve',
        ].includes(p.action)) ||
      (p.resource === 'goods_receipts' &&
        ['view', 'create', 'receive'].includes(p.action)) ||
      (p.resource === 'dashboard' && p.action === 'view') ||
      (p.resource === 'reports' &&
        ['view', 'inventory', 'export'].includes(p.action)),
  );
  for (const p of storeKeeperPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.store_keeper!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.store_keeper!, permissionId: p.id },
    });
  }

  const warehouseReportPerms = allPermissions.filter(
    (p) =>
      (p.resource === 'reports' &&
        ['view', 'inventory', 'export'].includes(p.action)) ||
      (p.resource === 'dashboard' && p.action === 'view') ||
      (['inventory', 'parts'].includes(p.resource) && p.action === 'view'),
  );
  for (const p of warehouseReportPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.warehouse_manager!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.warehouse_manager!, permissionId: p.id },
    });
  }

  // Phase 15 — branch_admin / finance_manager report access
  const branchAdminReportPerms = allPermissions.filter(
    (p) =>
      p.resource === 'reports' &&
      ['view', 'workshop', 'inventory', 'finance', 'export'].includes(p.action),
  );
  for (const roleKey of ['branch_admin', 'finance_manager'] as const) {
    const roleId = roleIds[roleKey];
    if (!roleId) continue;
    for (const p of branchAdminReportPerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId: p.id },
        },
        update: {},
        create: { roleId, permissionId: p.id },
      });
    }
  }

  // Purchasing officer: create/view suppliers, PR, PO, GRN (no approve)
  const purchasingOfficerPerms = allPermissions.filter(
    (p) =>
      (['suppliers', 'purchase_requests', 'purchase_orders', 'goods_receipts', 'purchasing'].includes(
        p.resource,
      ) &&
        ['view', 'create', 'update', 'cancel', 'receive'].includes(p.action)) ||
      (['parts', 'inventory'].includes(p.resource) && p.action === 'view') ||
      (p.resource === 'dashboard' && p.action === 'view'),
  );
  for (const p of purchasingOfficerPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.purchasing_officer!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.purchasing_officer!, permissionId: p.id },
    });
  }

  // Purchasing manager: officer + approve/reject
  const purchasingManagerPerms = allPermissions.filter(
    (p) =>
      (['suppliers', 'purchase_requests', 'purchase_orders', 'goods_receipts', 'purchasing'].includes(
        p.resource,
      ) &&
        [
          'view',
          'create',
          'update',
          'cancel',
          'approve',
          'reject',
          'receive',
          'manage',
        ].includes(p.action)) ||
      (['parts', 'inventory'].includes(p.resource) && p.action === 'view') ||
      (p.resource === 'dashboard' && p.action === 'view'),
  );
  for (const p of purchasingManagerPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.purchasing_manager!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.purchasing_manager!, permissionId: p.id },
    });
  }

  // Technician: inventory/parts view only
  const techInv = allPermissions.filter(
    (p) =>
      ['inventory', 'parts', 'reservations'].includes(p.resource) &&
      p.action === 'view',
  );
  for (const p of techInv) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.technician!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.technician!, permissionId: p.id },
    });
  }

  // Accountant: full finance + visit visits for delivery context
  const accountantPerms = allPermissions.filter(
    (p) =>
      (['invoices', 'payments', 'expenses', 'taxes'].includes(p.resource) &&
        [
          'view',
          'create',
          'update',
          'delete',
          'cancel',
          'manage',
          'refund',
          'export',
        ].includes(p.action)) ||
      (['visits', 'customers', 'quotations'].includes(p.resource) &&
        p.action === 'view') ||
      (p.resource === 'visits' && p.action === 'complete') ||
      (p.resource === 'dashboard' && p.action === 'view') ||
      (p.resource === 'reports' &&
        ['view', 'finance', 'export'].includes(p.action)),
  );
  for (const p of accountantPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.accountant!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.accountant!, permissionId: p.id },
    });
  }

  // Reception: view finance + deliver
  const receptionFinance = allPermissions.filter(
    (p) =>
      (['invoices', 'payments', 'taxes'].includes(p.resource) &&
        p.action === 'view') ||
      (p.resource === 'payments' && p.action === 'create') ||
      (p.resource === 'visits' && p.action === 'complete'),
  );
  for (const p of receptionFinance) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.reception!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.reception!, permissionId: p.id },
    });
  }

  // Notifications: staff roles get view
  const notifView = allPermissions.filter(
    (p) => p.resource === 'notifications' && p.action === 'view',
  );
  for (const roleKey of [
    'advisor',
    'reception',
    'workshop_manager',
    'technician',
    'store_keeper',
    'warehouse_manager',
    'purchasing_officer',
    'purchasing_manager',
    'accountant',
    'quality_controller',
    'branch_admin',
  ] as const) {
    const roleId = roleIds[roleKey];
    if (!roleId) continue;
    for (const p of notifView) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId: p.id },
        },
        update: {},
        create: { roleId, permissionId: p.id },
      });
    }
  }

  // Phase 16 — customer portal role (own data only via portal controllers)
  const customerPortalPerms = allPermissions.filter(
    (p) =>
      p.resource === 'portal' &&
      ['view', 'create', 'approve', 'reject'].includes(p.action),
  );
  for (const p of customerPortalPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds.customer!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds.customer!, permissionId: p.id },
    });
  }

  await prisma.taxRate.createMany({
    data: [
      {
        organizationId: org.id,
        name: 'VAT 14%',
        rate: 14,
        isDefault: true,
        effectiveFrom: new Date('2024-01-01'),
      },
    ],
    skipDuplicates: true,
  });

  const settings: { key: string; value: unknown }[] = [
    { key: 'currency', value: 'EGP' },
    { key: 'default_tax_rate', value: 14 },
    { key: 'invoice_prefix', value: 'INV-2026-' },
    {
      key: 'working_hours',
      value: { start: '09:00', end: '18:00' },
    },
    {
      key: 'number_sequences',
      value: {
        JT: { prefix: 'JT', year: 2026, next: 1 },
        WO: { prefix: 'WO', year: 2026, next: 1 },
        Q: { prefix: 'Q', year: 2026, next: 1 },
        INV: { prefix: 'INV', year: 2026, next: 1 },
        PAY: { prefix: 'PAY', year: 2026, next: 1 },
        PR: { prefix: 'PR', year: 2026, next: 1 },
        PO: { prefix: 'PO', year: 2026, next: 1 },
        GRN: { prefix: 'GRN', year: 2026, next: 1 },
      },
    },
    {
      key: 'notification_prefs',
      value: {
        lowStockAlerts: true,
        customerApprovalAlerts: true,
        deliveryDelayAlerts: true,
        dailyEmailDigest: false,
      },
    },
  ];

  for (const s of settings) {
    if (s.key === 'number_sequences') {
      // Do not reset counters on re-seed — only create if missing
      await prisma.systemSetting.upsert({
        where: {
          organizationId_key: { organizationId: org.id, key: s.key },
        },
        update: {},
        create: {
          organizationId: org.id,
          key: s.key,
          value: s.value as object,
        },
      });
      continue;
    }
    await prisma.systemSetting.upsert({
      where: {
        organizationId_key: { organizationId: org.id, key: s.key },
      },
      update: { value: s.value as object },
      create: {
        organizationId: org.id,
        key: s.key,
        value: s.value as object,
      },
    });
  }

  // Align JT/Q/etc. next counters with existing documents (safe re-seed)
  const seqSetting = await prisma.systemSetting.findUnique({
    where: {
      organizationId_key: { organizationId: org.id, key: 'number_sequences' },
    },
  });
  if (seqSetting) {
    const year = new Date().getFullYear();
    const sequences = { ...(seqSetting.value as Record<string, { prefix: string; year: number; next: number }>) };
    const maxTicket = await prisma.jobTicket.findFirst({
      where: { organizationId: org.id, number: { startsWith: `JT-${year}-` } },
      orderBy: { number: 'desc' },
    });
    if (maxTicket) {
      const n = Number(maxTicket.number.split('-').pop());
      if (Number.isFinite(n)) {
        sequences.JT = { prefix: 'JT', year, next: n + 1 };
      }
    }
    const maxQuote = await prisma.quotation.findFirst({
      where: { organizationId: org.id, number: { startsWith: `Q-${year}-` } },
      orderBy: { number: 'desc' },
    });
    if (maxQuote) {
      const n = Number(maxQuote.number.split('-').pop());
      if (Number.isFinite(n)) {
        sequences.Q = { prefix: 'Q', year, next: n + 1 };
      }
    }
    const maxWo = await prisma.workOrder.findFirst({
      where: { organizationId: org.id, number: { startsWith: `WO-${year}-` } },
      orderBy: { createdAt: 'desc' },
    });
    if (maxWo) {
      const n = Number(maxWo.number.split('-').pop());
      if (Number.isFinite(n)) {
        sequences.WO = {
          prefix: 'WO',
          year,
          next: Math.max(sequences.WO?.next ?? 1, n + 1),
        };
      }
    }
    // Also sync against numeric max across all WO numbers for this year
    const allWo = await prisma.workOrder.findMany({
      where: { organizationId: org.id, number: { startsWith: `WO-${year}-` } },
      select: { number: true },
    });
    const maxWoNum = allWo.reduce((m, w) => {
      const n = Number(w.number.split('-').pop());
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    if (maxWoNum > 0) {
      sequences.WO = { prefix: 'WO', year, next: maxWoNum + 1 };
    }
    const allQ = await prisma.quotation.findMany({
      where: { organizationId: org.id, number: { startsWith: `Q-${year}-` } },
      select: { number: true },
    });
    const maxQNum = allQ.reduce((m, w) => {
      const n = Number(w.number.split('-').pop());
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    if (maxQNum > 0) {
      sequences.Q = { prefix: 'Q', year, next: maxQNum + 1 };
    }
    const allJt = await prisma.jobTicket.findMany({
      where: { organizationId: org.id, number: { startsWith: `JT-${year}-` } },
      select: { number: true },
    });
    const maxJtNum = allJt.reduce((m, w) => {
      const n = Number(w.number.split('-').pop());
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    if (maxJtNum > 0) {
      sequences.JT = { prefix: 'JT', year, next: maxJtNum + 1 };
    }
    await prisma.systemSetting.update({
      where: { id: seqSetting.id },
      data: { value: sequences },
    });
  }

  for (const code of Object.keys(branches)) {
    await prisma.warehouse.upsert({
      where: {
        branchId_code: { branchId: branches[code]!, code: 'MAIN' },
      },
      update: {},
      create: {
        branchId: branches[code]!,
        code: 'MAIN',
        nameEn: 'Main Warehouse',
        nameAr: 'المخزن الرئيسي',
        isDefault: true,
      },
    });
  }

  // Inspection template (10-point checklist from FE)
  const template = await prisma.inspectionTemplate.upsert({
    where: {
      organizationId_code_version: {
        organizationId: org.id,
        code: 'DEFAULT_10PT',
        version: 1,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      code: 'DEFAULT_10PT',
      nameEn: 'Standard 10-Point Inspection',
      nameAr: 'فحص قياسي من ١٠ نقاط',
      version: 1,
      isActive: true,
      items: {
        create: [
          { nameEn: 'Engine', nameAr: 'المحرك', sortOrder: 1 },
          { nameEn: 'Transmission', nameAr: 'ناقل الحركة', sortOrder: 2 },
          { nameEn: 'Brakes', nameAr: 'الفرامل', sortOrder: 3 },
          { nameEn: 'Suspension', nameAr: 'نظام التعليق', sortOrder: 4 },
          { nameEn: 'Air Conditioning', nameAr: 'التكييف', sortOrder: 5 },
          { nameEn: 'Electrical', nameAr: 'الكهرباء', sortOrder: 6 },
          { nameEn: 'Tires', nameAr: 'الإطارات', sortOrder: 7 },
          { nameEn: 'Body', nameAr: 'الهيكل', sortOrder: 8 },
          { nameEn: 'Oil & Fluids', nameAr: 'الزيوت والسوائل', sortOrder: 9 },
          { nameEn: 'Battery', nameAr: 'البطارية', sortOrder: 10 },
        ],
      },
    },
  });

  for (const u of DEMO_USERS) {
    const employee = await prisma.employee.create({
      data: {
        organizationId: org.id,
        branchId: branches[u.branchCode]!,
        nameEn: u.nameEn,
        nameAr: u.nameAr,
        phone: u.phone,
        status: 'active',
      },
    });

    const user = await prisma.user.upsert({
      where: {
        organizationId_email: { organizationId: org.id, email: u.email },
      },
      update: {
        passwordHash,
        status: 'active',
      },
      create: {
        organizationId: org.id,
        employeeId: employee.id,
        email: u.email,
        passwordHash,
        userType: 'staff',
        status: 'active',
        locale: 'en',
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: user.id, roleId: roleIds[u.roleKey]! },
      },
      update: {
        branchId:
          u.roleKey === 'super_admin' ? null : branches[u.branchCode]!,
      },
      create: {
        userId: user.id,
        roleId: roleIds[u.roleKey]!,
        branchId:
          u.roleKey === 'super_admin' ? null : branches[u.branchCode]!,
      },
    });

    // Branch access: super_admin → all; others → home branch
    const accessBranches =
      u.roleKey === 'super_admin'
        ? Object.values(branches)
        : [branches[u.branchCode]!];
    for (const branchId of accessBranches) {
      await prisma.userBranchAccess.upsert({
        where: { userId_branchId: { userId: user.id, branchId } },
        update: {},
        create: { userId: user.id, branchId },
      });
    }
  }

  // Demo customers from mock-data
  const customers = [
    {
      nameEn: 'Ahmed Hassan',
      nameAr: 'أحمد حسن',
      phone: '+20 100 214 8890',
      status: 'active' as const,
    },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: {
        organizationId_phone: { organizationId: org.id, phone: c.phone },
      },
      update: {},
      create: {
        organizationId: org.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        phone: c.phone,
        whatsapp: c.phone,
        status: c.status,
        preferredBranchId: branches.b1,
      },
    });
  }

  const ahmed = await prisma.customer.findFirstOrThrow({
    where: { phone: '+20 100 214 8890' },
  });

  const customerUser = await prisma.user.upsert({
    where: { customerId: ahmed.id },
    update: {
      passwordHash,
      status: 'active',
    },
    create: {
      organizationId: org.id,
      customerId: ahmed.id,
      email: 'customer@promotors.eg',
      username: ahmed.phone,
      passwordHash,
      userType: 'customer',
      status: 'active',
      locale: 'en',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: customerUser.id, roleId: roleIds.customer! },
    },
    update: {},
    create: {
      userId: customerUser.id,
      roleId: roleIds.customer!,
    },
  });

  console.log('Seed complete.');
  console.log(`Organization: ${org.nameEn}`);
  console.log(`Demo password for all users: Password123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
