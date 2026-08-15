import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

export type SettingsDto = {
  company: {
    nameEn: string;
    nameAr: string;
    taxId: string | null;
    phone: string | null;
    email: string | null;
  };
  currency: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  workingHours: { start: string; end: string };
  notifications: {
    lowStockAlerts: boolean;
    customerApprovalAlerts: boolean;
    deliveryDelayAlerts: boolean;
    dailyEmailDigest: boolean;
  };
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<SettingsDto> {
    const [org, settings] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      }),
      this.prisma.systemSetting.findMany({ where: { organizationId } }),
    ]);
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    return {
      company: {
        nameEn: org.nameEn,
        nameAr: org.nameAr,
        taxId: org.taxId,
        phone: org.phone,
        email: org.email,
      },
      currency: (map.currency as string) ?? 'EGP',
      defaultTaxRate: Number(map.default_tax_rate ?? 14),
      invoicePrefix: (map.invoice_prefix as string) ?? 'INV-2026-',
      workingHours: (map.working_hours as { start: string; end: string }) ?? {
        start: '09:00',
        end: '18:00',
      },
      notifications:
        (map.notification_prefs as SettingsDto['notifications']) ?? {
          lowStockAlerts: true,
          customerApprovalAlerts: true,
          deliveryDelayAlerts: true,
          dailyEmailDigest: false,
        },
    };
  }

  async update(
    organizationId: string,
    actorId: string,
    patch: Partial<{
      company: Partial<SettingsDto['company']>;
      currency: string;
      defaultTaxRate: number;
      invoicePrefix: string;
      workingHours: SettingsDto['workingHours'];
      notifications: Partial<SettingsDto['notifications']>;
    }>,
  ) {
    const before = await this.get(organizationId);

    await this.prisma.$transaction(async (tx) => {
      if (patch.company) {
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            nameEn: patch.company.nameEn,
            nameAr: patch.company.nameAr,
            taxId: patch.company.taxId,
            phone: patch.company.phone,
            email: patch.company.email,
          },
        });
      }

      const upserts: { key: string; value: Prisma.InputJsonValue }[] = [];
      if (patch.currency !== undefined) {
        upserts.push({ key: 'currency', value: patch.currency });
      }
      if (patch.defaultTaxRate !== undefined) {
        upserts.push({ key: 'default_tax_rate', value: patch.defaultTaxRate });
      }
      if (patch.invoicePrefix !== undefined) {
        upserts.push({ key: 'invoice_prefix', value: patch.invoicePrefix });
      }
      if (patch.workingHours !== undefined) {
        upserts.push({
          key: 'working_hours',
          value: patch.workingHours,
        });
      }
      if (patch.notifications !== undefined) {
        const merged = {
          ...before.notifications,
          ...patch.notifications,
        };
        upserts.push({
          key: 'notification_prefs',
          value: merged,
        });
      }

      for (const item of upserts) {
        await tx.systemSetting.upsert({
          where: {
            organizationId_key: {
              organizationId,
              key: item.key,
            },
          },
          update: { value: item.value },
          create: {
            organizationId,
            key: item.key,
            value: item.value,
          },
        });
      }
    });

    const after = await this.get(organizationId);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'settings.update',
      entity: 'SystemSetting',
      entityId: organizationId,
      before,
      after,
    });
    return after;
  }
}
