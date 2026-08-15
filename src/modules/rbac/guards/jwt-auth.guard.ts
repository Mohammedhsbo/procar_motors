import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ErrorCodes } from '../../../common/constants/error-codes';
import { IS_PUBLIC_KEY } from '../decorators/rbac.decorators';

@Injectable()
export class JwtAuthGuard
  extends PassportAuthGuard('jwt')
  implements CanActivate
{
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw (
        err ??
        new UnauthorizedException({
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
        })
      );
    }
    return user;
  }
}
