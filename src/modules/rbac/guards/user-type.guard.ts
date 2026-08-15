import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes';
import type { AuthUserContext } from '../../auth/auth.types';
import { IS_PUBLIC_KEY, USER_TYPES_KEY } from '../decorators/rbac.decorators';

@Injectable()
export class UserTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<
      Array<'staff' | 'customer'>
    >(USER_TYPES_KEY, [context.getHandler(), context.getClass()]);

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUserContext }>();
    const user = request.user;

    // Default staff-only: customers must be explicitly allowed via @RequireUserTypes('customer')
    if (!allowed || allowed.length === 0) {
      if (user?.userType === 'customer') {
        throw new ForbiddenException({
          code: ErrorCodes.FORBIDDEN,
          message: 'Customer portal tokens cannot access staff APIs',
        });
      }
      return true;
    }

    if (!user) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Missing authenticated user',
      });
    }

    if (!allowed.includes(user.userType)) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: `This endpoint requires userType: ${allowed.join('|')}`,
        details: { userType: user.userType },
      });
    }

    if (user.userType === 'customer' && !user.customerId) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Portal session missing customerId',
      });
    }

    return true;
  }
}
