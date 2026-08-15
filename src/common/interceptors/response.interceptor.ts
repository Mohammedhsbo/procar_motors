import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { Observable, map } from 'rxjs';

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta: {
    requestId: string;
    [key: string]: unknown;
  };
};

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

    return next.handle().pipe(
      map((data) => {
        // Allow handlers to return { data, meta } for pagination etc.
        if (
          data !== null &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          const wrapped = data as { data: T; meta: Record<string, unknown> };
          return {
            success: true as const,
            data: wrapped.data,
            meta: {
              requestId,
              ...wrapped.meta,
            },
          };
        }

        return {
          success: true as const,
          data,
          meta: { requestId },
        };
      }),
    );
  }
}
