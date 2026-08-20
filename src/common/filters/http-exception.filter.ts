import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ErrorCodes } from '../constants/error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

    let status: number = Number(HttpStatus.INTERNAL_SERVER_ERROR);
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = Number(exception.getStatus());
      const body = exception.getResponse();

      if (typeof body === 'string') {
        // Framework exceptions such as ThrottlerException respond with a bare
        // string, so the code still has to come from the status.
        message = body;
        code = this.mapStatusToCode(status);
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        message =
          (typeof obj.message === 'string'
            ? obj.message
            : Array.isArray(obj.message)
              ? obj.message.join(', ')
              : exception.message) || message;
        code =
          typeof obj.code === 'string'
            ? obj.code
            : this.mapStatusToCode(status);
        details = obj.details ?? obj.errors;
        if (Array.isArray(obj.message)) {
          details = obj.message;
        }
      } else {
        code = this.mapStatusToCode(status);
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack, requestId);
    }

    if (status >= 500 && !(exception instanceof HttpException)) {
      message = 'Internal server error';
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      requestId,
    });
  }

  private mapStatusToCode(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: ErrorCodes.VALIDATION_ERROR,
      [HttpStatus.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: ErrorCodes.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCodes.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCodes.CONFLICT,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCodes.VALIDATION_ERROR,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCodes.RATE_LIMITED,
      [HttpStatus.LOCKED]: ErrorCodes.ACCOUNT_LOCKED,
      [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCodes.SERVICE_UNAVAILABLE,
    };
    return map[status] ?? ErrorCodes.INTERNAL_ERROR;
  }
}
