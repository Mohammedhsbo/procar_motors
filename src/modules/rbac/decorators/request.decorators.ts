import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUserContext } from '../../auth/auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AuthUserContext }>();
    return request.user;
  },
);

export const BranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers['x-branch-id'];
    return typeof header === 'string' ? header : undefined;
  },
);
