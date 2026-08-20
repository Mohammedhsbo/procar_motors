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
  APPS_KEY,
  IS_PUBLIC_KEY,
  SKIP_APP_KEY,
} from '../decorators/rbac.decorators';

/**
 * Enforces `@RequireApp('tirezone')` style route scoping. Routes without the
 * decorator are unaffected, so the Pro Motors surface keeps working unchanged.
 */
@Injectable()
export class AppAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Handler-level opt-out wins over the controller's @RequireApp.
    const skip = this.reflector.get<boolean>(SKIP_APP_KEY, context.getHandler());
    if (skip) return true;

    const required = this.reflector.getAllAndOverride<string[]>(APPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

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

    if (user.roles.includes('super_admin')) return true;

    const granted = user.apps ?? [];
    if (!required.some((app) => granted.includes(app))) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'No access to this application',
        details: { required, granted },
      });
    }

    return true;
  }
}
