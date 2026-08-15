import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(
    eventType: string,
    payload: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    await client.outboxEvent.create({
      data: {
        eventType,
        payload: payload as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
    this.logger.log(`event emitted: ${eventType}`);
  }
}
