import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes';
import { isAppCode } from '../../common/constants/applications';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Every application registered for the organization. */
  async list(organizationId: string) {
    const apps = await this.prisma.application.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
    return apps.map((a) => this.toDto(a));
  }

  /** Applications the caller may open, with their landing app first. */
  async listMine(userId: string, organizationId: string, roleKeys: string[]) {
    const codes = await this.auth.getAppCodesForUser(userId, roleKeys);
    if (codes.length === 0) return [];

    const [apps, access] = await Promise.all([
      this.prisma.application.findMany({
        where: { organizationId, code: { in: codes }, status: 'active' },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.userAppAccess.findMany({
        where: { userId },
        select: { applicationId: true, isDefault: true },
      }),
    ]);

    const defaults = new Set(
      access.filter((a) => a.isDefault).map((a) => a.applicationId),
    );

    return apps
      .map((a) => ({ ...this.toDto(a), isDefault: defaults.has(a.id) }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  /** Applications enabled at a branch. */
  async listForBranch(organizationId: string, branchId: string) {
    const rows = await this.prisma.branchApplication.findMany({
      where: {
        branchId,
        enabled: true,
        application: { organizationId, status: 'active' },
      },
      include: { application: true },
      orderBy: { application: { sortOrder: 'asc' } },
    });
    return rows.map((r) => this.toDto(r.application));
  }

  /** Grant or update a user's access to an application. */
  async grant(
    organizationId: string,
    actorId: string,
    userId: string,
    appCode: string,
    isDefault = false,
  ) {
    const app = await this.requireApp(organizationId, appCode);
    await this.requireUser(organizationId, userId);

    if (isDefault) {
      await this.prisma.userAppAccess.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const row = await this.prisma.userAppAccess.upsert({
      where: {
        userId_applicationId: { userId, applicationId: app.id },
      },
      create: {
        userId,
        applicationId: app.id,
        isDefault,
        grantedBy: actorId,
        status: 'active',
      },
      update: { isDefault, status: 'active', grantedBy: actorId },
    });

    return {
      userId: row.userId,
      application: app.code,
      isDefault: row.isDefault,
      status: row.status,
      grantedAt: row.grantedAt,
    };
  }

  /** Revoke a user's access to an application. */
  async revoke(organizationId: string, userId: string, appCode: string) {
    const app = await this.requireApp(organizationId, appCode);
    await this.prisma.userAppAccess.deleteMany({
      where: { userId, applicationId: app.id },
    });
    return { userId, application: app.code, revoked: true };
  }

  /** Applications granted to a specific user (admin view). */
  async listForUser(organizationId: string, userId: string) {
    await this.requireUser(organizationId, userId);
    const rows = await this.prisma.userAppAccess.findMany({
      where: { userId, application: { organizationId } },
      include: { application: true },
      orderBy: { application: { sortOrder: 'asc' } },
    });
    return rows.map((r) => ({
      ...this.toDto(r.application),
      isDefault: r.isDefault,
      status: r.status,
      grantedAt: r.grantedAt,
    }));
  }

  /** Enable or disable an application at a branch. */
  async setBranchApplication(
    organizationId: string,
    branchId: string,
    appCode: string,
    enabled: boolean,
  ) {
    const app = await this.requireApp(organizationId, appCode);
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Branch not found',
      });
    }

    await this.prisma.branchApplication.upsert({
      where: {
        branchId_applicationId: { branchId, applicationId: app.id },
      },
      create: { branchId, applicationId: app.id, enabled },
      update: { enabled },
    });

    return { branchId, application: app.code, enabled };
  }

  private async requireApp(organizationId: string, code: string) {
    if (!isAppCode(code)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown application code: ${code}`,
      });
    }
    const app = await this.prisma.application.findFirst({
      where: { organizationId, code },
    });
    if (!app) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Application not registered for this organization',
      });
    }
    return app;
  }

  private async requireUser(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'User not found',
      });
    }
    return user;
  }

  private toDto(app: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    description: string | null;
    baseUrl: string | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
    status: string;
  }) {
    return {
      id: app.id,
      code: app.code,
      nameEn: app.nameEn,
      nameAr: app.nameAr,
      description: app.description,
      baseUrl: app.baseUrl,
      icon: app.icon,
      color: app.color,
      sortOrder: app.sortOrder,
      status: app.status,
    };
  }
}
