import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomInt, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisCacheService } from '../../infrastructure/cache/redis-cache.service';
import { AuthService } from '../auth/auth.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';
import type { EnvConfig } from '../../config/env.validation';
import { OTP_DELIVERY, type OtpDeliveryProvider } from './otp/otp-delivery';

const OTP_TTL_SEC = 300;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(OTP_DELIVERY) private readonly otpDelivery: OtpDeliveryProvider,
  ) {}

  async requestOtp(phone: string, ip?: string) {
    const normalized = normalizePhone(phone);
    if (normalized.length < 10) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid phone number',
      });
    }

    const customer = await this.findCustomerByPhone(normalized);
    // Always return generic success to avoid account enumeration
    if (!customer) {
      this.logger.debug(`OTP requested for unknown phone ${normalized}`);
      return {
        sent: true,
        expiresInSec: OTP_TTL_SEC,
        message: 'If the phone is registered, an OTP has been sent',
      };
    }

    const code = String(randomInt(100000, 999999));
    const key = this.otpKey(customer.id);
    await this.cache.setJson(
      key,
      { code, attempts: 0, phone: customer.phone },
      OTP_TTL_SEC,
    );

    await this.otpDelivery.sendOtp({
      phone: customer.phone,
      code,
      customerId: customer.id,
    });

    await this.audit.log({
      organizationId: customer.organizationId,
      actorId: null,
      action: 'portal.otp.requested',
      entity: 'Customer',
      entityId: customer.id,
      after: { phone: customer.phone, ip: ip ?? null },
    });

    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    // Production MUST never return the OTP in the API body.
    const exposeDevCode = nodeEnv !== 'production';

    return {
      sent: true,
      expiresInSec: OTP_TTL_SEC,
      message: 'If the phone is registered, an OTP has been sent',
      ...(exposeDevCode ? { devCode: code } : {}),
    };
  }

  async verifyOtp(params: {
    phone: string;
    code: string;
    ip?: string;
    deviceInfo?: string;
  }) {
    const normalized = normalizePhone(params.phone);
    const customer = await this.findCustomerByPhone(normalized);
    if (!customer) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid phone or OTP',
      });
    }

    const key = this.otpKey(customer.id);
    const stored = await this.cache.getJson<{
      code: string;
      attempts: number;
    }>(key);
    if (!stored) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'OTP expired or not requested',
      });
    }

    if (stored.attempts >= OTP_MAX_ATTEMPTS) {
      await this.cache.del(key);
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Too many invalid OTP attempts',
      });
    }

    if (stored.code !== params.code.trim()) {
      await this.cache.setJson(
        key,
        { ...stored, attempts: stored.attempts + 1 },
        OTP_TTL_SEC,
      );
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid phone or OTP',
      });
    }

    await this.cache.del(key);

    const user = await this.ensurePortalUser(customer);
    const roles = user.roles.map((r) => r.role.key);
    const tokens = await this.auth.issueSessionForUser({
      userId: user.id,
      orgId: customer.organizationId,
      userType: 'customer',
      roles,
      branchIds: [],
      customerId: customer.id,
      deviceInfo: params.deviceInfo,
      ip: params.ip,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0 },
    });

    await this.audit.log({
      organizationId: customer.organizationId,
      actorId: user.id,
      action: 'portal.otp.verified',
      entity: 'Customer',
      entityId: customer.id,
      after: { ip: params.ip ?? null },
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        customerId: customer.id,
        nameEn: customer.nameEn,
        nameAr: customer.nameAr,
        phone: customer.phone,
        userType: 'customer' as const,
        locale: user.locale,
        roles,
      },
    };
  }

  private otpKey(customerId: string) {
    return `portal:otp:${customerId}`;
  }

  private async findCustomerByPhone(normalizedDigits: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        status: { in: ['active', 'vip'] },
      },
      take: 2000,
    });
    return (
      customers.find((c) => normalizePhone(c.phone) === normalizedDigits) ??
      null
    );
  }

  private async ensurePortalUser(customer: {
    id: string;
    organizationId: string;
    phone: string;
    nameEn: string;
    nameAr: string;
  }) {
    const existing = await this.prisma.user.findFirst({
      where: {
        organizationId: customer.organizationId,
        customerId: customer.id,
        deletedAt: null,
      },
      include: { roles: { include: { role: true } } },
    });
    if (existing) {
      if (existing.userType !== 'customer') {
        throw new UnauthorizedException({
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Account cannot use portal login',
        });
      }
      return existing;
    }

    const role = await this.prisma.role.findFirst({
      where: {
        organizationId: customer.organizationId,
        key: 'customer',
      },
    });
    if (!role) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Customer role not configured',
      });
    }

    // OTP-only account — unusable random password hash
    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));

    return this.prisma.user.create({
      data: {
        organizationId: customer.organizationId,
        customerId: customer.id,
        userType: 'customer',
        status: 'active',
        passwordHash,
        locale: 'en',
        roles: { create: { roleId: role.id } },
      },
      include: { roles: { include: { role: true } } },
    });
  }
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
