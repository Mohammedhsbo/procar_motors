import { createHash } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../constants/error-codes';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashRequest(body: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(body ?? null))
      .digest('hex');
  }

  async find(key: string) {
    return this.prisma.idempotencyKey.findUnique({ where: { key } });
  }

  async beginOrReplay<T>(params: {
    key: string;
    userId: string;
    requestHash: string;
  }): Promise<{ replay: true; body: T; status: number } | { replay: false }> {
    const existing = await this.find(params.key);
    if (!existing) return { replay: false };

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.prisma.idempotencyKey.delete({ where: { key: params.key } });
      return { replay: false };
    }

    if (existing.requestHash !== params.requestHash) {
      throw new ConflictException({
        code: ErrorCodes.IDEMPOTENCY_REPLAY,
        message: 'Idempotency-Key reused with a different payload',
      });
    }

    return {
      replay: true,
      body: existing.responseBody as T,
      status: existing.responseStatus,
    };
  }

  async save(params: {
    key: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
    ttlHours?: number;
  }) {
    const expiresAt = new Date(
      Date.now() + (params.ttlHours ?? 24) * 60 * 60 * 1000,
    );
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: params.key,
          userId: params.userId,
          requestHash: params.requestHash,
          responseStatus: params.responseStatus,
          responseBody: params.responseBody as Prisma.InputJsonValue,
          expiresAt,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const replay = await this.beginOrReplay({
          key: params.key,
          userId: params.userId,
          requestHash: params.requestHash,
        });
        if (replay.replay) return;
        throw new ConflictException({
          code: ErrorCodes.IDEMPOTENCY_REPLAY,
          message: 'Idempotency-Key conflict',
        });
      }
      throw e;
    }
  }
}
