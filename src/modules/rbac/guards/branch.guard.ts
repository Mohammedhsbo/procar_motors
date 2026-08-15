import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes';
import type { AuthUserContext } from '../../auth/auth.types';
import { IS_PUBLIC_KEY, SKIP_BRANCH_KEY } from '../decorators/rbac.decorators';

@Injectable()
export class BranchGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipBranch = this.reflector.getAllAndOverride<boolean>(
      SKIP_BRANCH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipBranch) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthUserContext;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Missing authenticated user',
      });
    }

    const raw = request.headers['x-branch-id'];
    const branchId = typeof raw === 'string' ? raw : undefined;

    if (!branchId) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'X-Branch-Id header is required',
      });
    }

    if (user.roles.includes('super_admin')) {
      return true;
    }

    if (!user.branchIds.includes(branchId)) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'You do not have access to this branch',
        details: { branchId },
      });
    }

    return true;
  }
}
