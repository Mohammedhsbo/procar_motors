/**
 * Production seed.
 *
 * Creates only what the system cannot run without: the organisation, its
 * branches, the permission catalogue, the roles, the four applications, and a
 * single administrator whose password you supply.
 *
 * It creates no demo customers, no sample vehicles and no shared password.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' \
 *   ORG_NAME_EN='Pro Motors' ORG_NAME_AR='برو موتورز' \
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.prod.ts
 *
 * Safe to run more than once: everything is upserted.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const RESOURCES = [
  'users', 'customers', 'vehicles', 'visits', 'tickets', 'inspections',
  'work_orders', 'inventory', 'parts', 'reservations', 'purchasing',
  'purchase_requests', 'purchase_orders', 'suppliers', 'goods_receipts',
  'quotations', 'invoices', 'payments', 'expenses', 'taxes', 'reports',
  'settings', 'audit', 'board', 'qc', 'tasks', 'services', 'branches',
  'roles', 'notifications', 'dashboard', 'portal',
] as const;

const ACTIONS = [
  'view', 'create', 'update', 'delete', 'approve', 'reject', 'assign',
  'complete', 'cancel', 'receive', 'reserve', 'release', 'transfer',
  'consume', 'refund', 'export', 'send', 'manage', 'move',
] as const;

const EXTRA_PERMISSIONS = [
  { key: 'reports.workshop', resource: 'reports', action: 'workshop' },
  { key: 'reports.inventory', resource: 'reports', action: 'inventory' },
  { key: 'reports.finance', resource: 'reports', action: 'finance' },
];

const ROLES: { key: string; nameEn: string; nameAr: string; app: string | null }[] = [
  { key: 'super_admin', nameEn: 'Super Admin', nameAr: 'مدير النظام الأعلى', app: null },
  { key: 'branch_admin', nameEn: 'Branch Admin', nameAr: 'مدير الفرع', app: null },
  { key: 'accountant', nameEn: 'Accountant', nameAr: 'المحاسب', app: null },
  { key: 'finance_manager', nameEn: 'Finance Manager', nameAr: 'مدير المالية', app: null },
  { key: 'customer', nameEn: 'Customer', nameAr: 'عميل', app: null },
  { key: 'reception', nameEn: 'Reception', nameAr: 'الاستقبال', app: 'promotors' },
  { key: 'advisor', nameEn: 'Service Advisor', nameAr: 'مستشار الخدمة', app: 'promotors' },
  { key: 'workshop_manager', nameEn: 'Workshop Manager', nameAr: 'مدير الورشة', app: 'promotors' },
  { key: 'technician', nameEn: 'Technician', nameAr: 'فني', app: 'promotors' },
  { key: 'quality_controller', nameEn: 'Quality Controller', nameAr: 'مراقب الجودة', app: 'promotors' },
  { key: 'store_keeper', nameEn: 'Store Keeper', nameAr: 'أمين المخزن', app: 'promotors' },
  { key: 'warehouse_manager', nameEn: 'Warehouse Manager', nameAr: 'مدير المخزن', app: 'promotors' },
  { key: 'purchasing_officer', nameEn: 'Purchasing Officer', nameAr: 'مسؤول المشتريات', app: 'promotors' },
  { key: 'purchasing_manager', nameEn: 'Purchasing Manager', nameAr: 'مدير المشتريات', app: 'promotors' },
  { key: 'uxb_manager', nameEn: 'UXB Manager', nameAr: 'مدير يو إكس بي', app: 'uxb' },
  { key: 'uxb_advisor', nameEn: 'UXB Advisor', nameAr: 'مستشار يو إكس بي', app: 'uxb' },
  { key: 'uxb_technician', nameEn: 'UXB Technician', nameAr: 'فني يو إكس بي', app: 'uxb' },
  { key: 'tires_manager', nameEn: 'Tires Manager', nameAr: 'مدير تاير زون', app: 'tirezone' },
  { key: 'tires_sales', nameEn: 'Tires Sales', nameAr: 'مبيعات الإطارات', app: 'tirezone' },
  { key: 'tires_fitter', nameEn: 'Tire Fitter', nameAr: 'فني إطارات', app: 'tirezone' },
  { key: 'cafe_manager', nameEn: 'Cafe Manager', nameAr: 'مدير الكافيه', app: 'dailycup' },
  { key: 'cafe_cashier', nameEn: 'Cashier', nameAr: 'كاشير', app: 'dailycup' },
  { key: 'cafe_barista', nameEn: 'Barista', nameAr: 'باريستا', app: 'dailycup' },
];

const APPLICATIONS = [
  { code: 'promotors', nameEn: 'Pro Motors', nameAr: 'برو موتورز', color: '#12556b', sortOrder: 1 },
  { code: 'uxb', nameEn: 'UXB', nameAr: 'يو إكس بي', color: '#1f2933', sortOrder: 2 },
  { code: 'tirezone', nameEn: 'Tire Zone', nameAr: 'تاير زون', color: '#b4641a', sortOrder: 3 },
  { code: 'dailycup', nameEn: 'Daily Cup', nameAr: 'ديلي كب', color: '#7a4b2a', sortOrder: 4 },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required. Refusing to seed production without it.`);
  }
  return value.trim();
}

async function main() {
  const adminEmail = required('ADMIN_EMAIL').toLowerCase();
  const adminPassword = required('ADMIN_PASSWORD');

  if (adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  }
  if (/password|123456|changeme|admin123/i.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD looks like a default. Choose a real one.');
  }

  const orgNameEn = process.env['ORG_NAME_EN']?.trim() || 'Pro Motors';
  const orgNameAr = process.env['ORG_NAME_AR']?.trim() || orgNameEn;
  const branchNameEn = process.env['BRANCH_NAME_EN']?.trim() || 'Main Branch';
  const branchNameAr = process.env['BRANCH_NAME_AR']?.trim() || 'الفرع الرئيسي';

  // ── Organisation and first branch ────────────────────────────────────────
  const existingOrg = await prisma.organization.findFirst({
    where: { deletedAt: null },
  });
  const org =
    existingOrg ??
    (await prisma.organization.create({
      data: {
        nameEn: orgNameEn,
        nameAr: orgNameAr,
        taxId: process.env['ORG_TAX_ID']?.trim() || null,
        phone: process.env['ORG_PHONE']?.trim() || null,
        email: process.env['ORG_EMAIL']?.trim() || null,
        status: 'active',
      },
    }));

  const branch = await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
    update: {},
    create: {
      organizationId: org.id,
      code: 'MAIN',
      nameEn: branchNameEn,
      nameAr: branchNameAr,
      isActive: true,
    },
  });

  await prisma.warehouse.upsert({
    where: { branchId_code: { branchId: branch.id, code: 'MAIN' } },
    update: {},
    create: {
      branchId: branch.id,
      code: 'MAIN',
      nameEn: 'Main Warehouse',
      nameAr: 'المخزن الرئيسي',
      isDefault: true,
    },
  });

  // ── Permission catalogue ─────────────────────────────────────────────────
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
  for (const p of EXTRA_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: {},
      create: { ...p, description: p.key },
    });
  }

  // ── Roles ────────────────────────────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: r.key } },
      update: { nameEn: r.nameEn, nameAr: r.nameAr, applicationCode: r.app },
      create: {
        organizationId: org.id,
        key: r.key,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        applicationCode: r.app,
        isSystem: true,
      },
    });
    roleIds[r.key] = role.id;
  }

  // Super admin holds every permission; the rest are granted by an
  // administrator from the Roles screen once the team is known.
  const allPermissions = await prisma.permission.findMany();
  for (const p of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: roleIds['super_admin']!,
          permissionId: p.id,
        },
      },
      update: {},
      create: { roleId: roleIds['super_admin']!, permissionId: p.id },
    });
  }

  // ── Applications ─────────────────────────────────────────────────────────
  const appIds: Record<string, string> = {};
  for (const a of APPLICATIONS) {
    const app = await prisma.application.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: {
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        color: a.color,
        sortOrder: a.sortOrder,
        status: 'active',
      },
      create: {
        organizationId: org.id,
        code: a.code,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        color: a.color,
        sortOrder: a.sortOrder,
        status: 'active',
      },
    });
    appIds[a.code] = app.id;

    await prisma.branchApplication.upsert({
      where: {
        branchId_applicationId: { branchId: branch.id, applicationId: app.id },
      },
      update: {},
      create: { branchId: branch.id, applicationId: app.id, enabled: true },
    });
  }

  // ── The one administrator ────────────────────────────────────────────────
  const existingEmployee = await prisma.employee.findFirst({
    where: { organizationId: org.id, branchId: branch.id, nameEn: 'Administrator' },
  });
  const employee =
    existingEmployee ??
    (await prisma.employee.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        nameEn: 'Administrator',
        nameAr: 'مدير النظام',
        status: 'active',
      },
    }));

  const passwordHash = await argon2.hash(adminPassword);
  const admin = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: adminEmail } },
    update: { passwordHash, status: 'active' },
    create: {
      organizationId: org.id,
      employeeId: employee.id,
      email: adminEmail,
      passwordHash,
      userType: 'staff',
      status: 'active',
      locale: 'ar',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: admin.id, roleId: roleIds['super_admin']! },
    },
    update: {},
    create: { userId: admin.id, roleId: roleIds['super_admin']! },
  });

  await prisma.userBranchAccess.upsert({
    where: { userId_branchId: { userId: admin.id, branchId: branch.id } },
    update: {},
    create: { userId: admin.id, branchId: branch.id },
  });

  for (const [index, code] of Object.keys(appIds).entries()) {
    await prisma.userAppAccess.upsert({
      where: {
        userId_applicationId: { userId: admin.id, applicationId: appIds[code]! },
      },
      update: { status: 'active' },
      create: {
        userId: admin.id,
        applicationId: appIds[code]!,
        isDefault: index === 0,
        status: 'active',
      },
    });
  }

  console.log('Production seed complete.');
  console.log(`  organisation : ${org.nameEn}`);
  console.log(`  branch       : ${branch.code} — ${branch.nameEn}`);
  console.log(`  roles        : ${ROLES.length}`);
  console.log(`  permissions  : ${allPermissions.length}`);
  console.log(`  applications : ${APPLICATIONS.length}`);
  console.log(`  administrator: ${adminEmail}`);
  console.log('');
  console.log('No demo data was created. Add branches, staff and catalogues');
  console.log('from the admin screens.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
