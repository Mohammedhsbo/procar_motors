import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import type { EnvConfig } from '../../config/env.validation';
import { ErrorCodes } from '../../common/constants/error-codes';
import { PrismaService } from '../../database/prisma.service';
import type { JwtAccessPayload } from './auth.types';
import {
  generateRefreshToken,
  hashToken,
  verifyPassword,
} from './password.util';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async login(params: {
    email: string;
    password: string;
    deviceInfo?: string;
    ip?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
      },
      include: {
        roles: { include: { role: true } },
        branches: true,
        employee: true,
      },
    });

    if (!user || user.userType !== 'staff') {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        {
          code: ErrorCodes.ACCOUNT_LOCKED,
          message: 'Account is temporarily locked due to failed login attempts',
          details: { lockedUntil: user.lockedUntil.toISOString() },
        },
        HttpStatus.LOCKED,
      );
    }

    if (user.status !== UserStatus.active) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Account is not active',
      });
    }

    const valid = await verifyPassword(user.passwordHash, params.password);
    if (!valid) {
      const failedLoginCount = user.failedLoginCount + 1;
      const lockedUntil =
        failedLoginCount >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil,
        },
      });

      if (lockedUntil) {
        throw new HttpException(
          {
            code: ErrorCodes.ACCOUNT_LOCKED,
            message:
              'Account is temporarily locked due to failed login attempts',
            details: { lockedUntil: lockedUntil.toISOString() },
          },
          HttpStatus.LOCKED,
        );
      }

      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const roles = user.roles.map((r) => r.role.key);
    const branchIds = user.branches.map((b) => b.branchId);
    const tokens = await this.issueTokens({
      userId: user.id,
      orgId: user.organizationId,
      userType: user.userType,
      roles,
      branchIds,
      deviceInfo: params.deviceInfo,
      ip: params.ip,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        nameEn: user.employee?.nameEn ?? null,
        nameAr: user.employee?.nameAr ?? null,
        userType: user.userType,
        locale: user.locale,
        roles,
        branchIds,
      },
    };
  }

  async refresh(refreshToken: string, ip?: string) {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: {
        user: {
          include: {
            roles: { include: { role: true } },
            branches: true,
          },
        },
      },
    });

    if (!stored) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid refresh token',
      });
    }

    // Reuse detection: revoked token presented again
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Refresh token reuse detected — please log in again',
      });
    }

    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Refresh token expired',
      });
    }

    if (stored.user.status !== UserStatus.active || stored.user.deletedAt) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Account is not active',
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const roles = stored.user.roles.map((r) => r.role.key);
    const branchIds = stored.user.branches.map((b) => b.branchId);

    return this.issueTokens({
      userId: stored.user.id,
      orgId: stored.user.organizationId,
      userType: stored.user.userType,
      roles,
      branchIds,
      customerId: stored.user.customerId,
      deviceInfo: stored.deviceInfo ?? undefined,
      ip,
      rotatedFrom: stored.id,
    });
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return { success: true };
    }
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { include: { role: true } },
        branches: true,
        employee: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'User not found',
      });
    }

    const roles = user.roles.map((r) => r.role.key);
    const branchIds = user.branches.map((b) => b.branchId);
    const permissions = await this.getPermissionKeysForRoles(
      user.roles.map((r) => r.roleId),
    );

    return {
      id: user.id,
      email: user.email,
      nameEn: user.employee?.nameEn ?? null,
      nameAr: user.employee?.nameAr ?? null,
      userType: user.userType,
      customerId: user.customerId,
      locale: user.locale,
      organizationId: user.organizationId,
      roles,
      branchIds,
      permissions,
      lastLoginAt: user.lastLoginAt,
    };
  }

  forgotPassword(email: string) {
    void email;
    // Stub — email dispatch in a later phase
    return {
      message:
        'If an account exists for that email, password reset instructions will be sent.',
    };
  }

  async getPermissionKeysForRoles(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      include: { permission: true },
    });
    return [...new Set(rows.map((r) => r.permission.key))];
  }

  /** Used by portal OTP verify to mint the same token shape as staff login. */
  async issueSessionForUser(params: {
    userId: string;
    orgId: string;
    userType: 'staff' | 'customer';
    roles: string[];
    branchIds: string[];
    customerId?: string | null;
    deviceInfo?: string;
    ip?: string;
  }) {
    return this.issueTokens(params);
  }

  private async issueTokens(params: {
    userId: string;
    orgId: string;
    userType: 'staff' | 'customer';
    roles: string[];
    branchIds: string[];
    customerId?: string | null;
    deviceInfo?: string;
    ip?: string;
    rotatedFrom?: string;
  }) {
    const payload: JwtAccessPayload = {
      sub: params.userId,
      orgId: params.orgId,
      userType: params.userType,
      roles: params.roles,
      branchIds: params.branchIds,
      customerId: params.customerId ?? null,
    };

    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const accessSecret = this.config.get('JWT_ACCESS_SECRET', { infer: true });

    const accessToken = await this.jwt.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessTtl as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });

    const refreshToken = generateRefreshToken();
    const tokenHash = hashToken(refreshToken);
    const expiresAt = this.addDuration(new Date(), refreshTtl);

    await this.prisma.refreshToken.create({
      data: {
        userId: params.userId,
        tokenHash,
        deviceInfo: params.deviceInfo,
        ip: params.ip,
        expiresAt,
        rotatedFrom: params.rotatedFrom,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      tokenType: 'Bearer' as const,
    };
  }

  private addDuration(from: Date, ttl: string): Date {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) {
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const ms =
      unit === 's'
        ? amount * 1000
        : unit === 'm'
          ? amount * 60 * 1000
          : unit === 'h'
            ? amount * 60 * 60 * 1000
            : amount * 24 * 60 * 60 * 1000;
    return new Date(from.getTime() + ms);
  }
}
