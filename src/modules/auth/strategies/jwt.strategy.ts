import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { EnvConfig } from '../../../config/env.validation';
import { ErrorCodes } from '../../../common/constants/error-codes';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthUserContext, JwtAccessPayload } from '../auth.types';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthUserContext> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 'active' },
      include: {
        roles: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired token',
      });
    }

    const permissions = await this.authService.getPermissionKeysForRoles(
      user.roles.map((r: { roleId: string }) => r.roleId),
    );

    return {
      sub: payload.sub,
      orgId: payload.orgId,
      userType: payload.userType,
      roles: payload.roles,
      branchIds: payload.branchIds,
      apps: payload.apps ?? [],
      customerId: payload.customerId ?? user.customerId ?? null,
      email: user.email,
      permissions,
    };
  }
}
