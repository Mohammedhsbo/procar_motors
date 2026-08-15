import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

/** FE permissionRows × permissionCols mapping */
export const MATRIX_RESOURCES = [
  { resource: 'users', labelEn: 'Users', labelAr: 'المستخدمون' },
  { resource: 'customers', labelEn: 'Customers', labelAr: 'العملاء' },
  { resource: 'vehicles', labelEn: 'Vehicles', labelAr: 'المركبات' },
  { resource: 'visits', labelEn: 'Visits', labelAr: 'الزيارات' },
  { resource: 'inspections', labelEn: 'Inspections', labelAr: 'الفحوصات' },
  { resource: 'work_orders', labelEn: 'Work Orders', labelAr: 'أوامر العمل' },
  { resource: 'inventory', labelEn: 'Inventory', labelAr: 'المخزون' },
  { resource: 'purchasing', labelEn: 'Purchasing', labelAr: 'المشتريات' },
  { resource: 'quotations', labelEn: 'Quotations', labelAr: 'عروض الأسعار' },
  { resource: 'invoices', labelEn: 'Invoices', labelAr: 'الفواتير' },
  { resource: 'payments', labelEn: 'Payments', labelAr: 'المدفوعات' },
  { resource: 'reports', labelEn: 'Reports', labelAr: 'التقارير' },
  { resource: 'settings', labelEn: 'Settings', labelAr: 'الإعدادات' },
] as const;

export const MATRIX_ACTIONS = [
  { action: 'view', labelEn: 'View', labelAr: 'عرض' },
  { action: 'create', labelEn: 'Create', labelAr: 'إنشاء' },
  { action: 'update', labelEn: 'Edit', labelAr: 'تعديل' },
  { action: 'delete', labelEn: 'Delete', labelAr: 'حذف' },
  { action: 'approve', labelEn: 'Approve', labelAr: 'اعتماد' },
  { action: 'export', labelEn: 'Export', labelAr: 'تصدير' },
] as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId },
      orderBy: { key: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      isSystem: r.isSystem,
    }));
  }

  async getPermissions(organizationId: string, roleId: string) {
    const role = await this.findRole(organizationId, roleId);
    const granted = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
    const grantedKeys = new Set(granted.map((g) => g.permission.key));

    const cells = MATRIX_RESOURCES.map((row) => ({
      resource: row.resource,
      labelEn: row.labelEn,
      labelAr: row.labelAr,
      actions: Object.fromEntries(
        MATRIX_ACTIONS.map((col) => [
          col.action,
          grantedKeys.has(`${row.resource}.${col.action}`),
        ]),
      ) as Record<(typeof MATRIX_ACTIONS)[number]['action'], boolean>,
    }));

    return {
      role: {
        id: role.id,
        key: role.key,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
      },
      permissionRows: MATRIX_RESOURCES.map((r) => ({
        en: r.labelEn,
        ar: r.labelAr,
        resource: r.resource,
      })),
      permissionCols: MATRIX_ACTIONS.map((a) => ({
        en: a.labelEn,
        ar: a.labelAr,
        action: a.action,
      })),
      cells,
      grantedKeys: [...grantedKeys].sort(),
    };
  }

  async updatePermissions(
    organizationId: string,
    actorId: string,
    roleId: string,
    permissionKeys: string[],
  ) {
    const role = await this.findRole(organizationId, roleId);
    if (role.key === 'super_admin') {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Cannot modify super_admin permissions',
      });
    }

    const allowed = new Set(
      MATRIX_RESOURCES.flatMap((r) =>
        MATRIX_ACTIONS.map((a) => `${r.resource}.${a.action}`),
      ),
    );
    const invalid = permissionKeys.filter((k) => !allowed.has(k));
    if (invalid.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid permission keys for matrix',
        details: { invalid },
      });
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    if (permissions.length !== permissionKeys.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more permissions do not exist in catalog',
      });
    }

    const before = await this.getPermissions(organizationId, roleId);

    await this.prisma.$transaction(async (tx) => {
      // Keep non-matrix permissions intact; replace only matrix keys
      const matrixPerms = await tx.permission.findMany({
        where: { key: { in: [...allowed] } },
      });
      const matrixIds = matrixPerms.map((p) => p.id);
      await tx.rolePermission.deleteMany({
        where: { roleId, permissionId: { in: matrixIds } },
      });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({
            roleId,
            permissionId: p.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    const after = await this.getPermissions(organizationId, roleId);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'role.permissions.update',
      entity: 'Role',
      entityId: roleId,
      before: { grantedKeys: before.grantedKeys },
      after: { grantedKeys: after.grantedKeys },
    });
    return after;
  }

  private async findRole(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
    });
    if (!role) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Role not found',
      });
    }
    return role;
  }
}
