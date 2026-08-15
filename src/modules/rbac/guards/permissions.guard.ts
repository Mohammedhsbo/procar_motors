import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes';
import type { AuthUserContext } from '../../auth/auth.types';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/rbac.decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredAll = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      (!requiredAll || requiredAll.length === 0) &&
      (!requiredAny || requiredAny.length === 0)
    ) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUserContext }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Missing authenticated user',
      });
    }

    if (user.roles.includes('super_admin')) {
      return true;
    }

    if (requiredAny && requiredAny.length > 0) {
      const hasAny = requiredAny.some((p) => user.permissions.includes(p));
      if (!hasAny) {
        throw new ForbiddenException({
          code: ErrorCodes.FORBIDDEN,
          message: 'Insufficient permissions',
          details: { requiredAny, missing: requiredAny },
        });
      }
    }

    if (requiredAll && requiredAll.length > 0) {
      const missing = requiredAll.filter((p) => !user.permissions.includes(p));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: ErrorCodes.FORBIDDEN,
          message: 'Insufficient permissions',
          details: { required: requiredAll, missing },
        });
      }
    }

    return true;
  }
}
