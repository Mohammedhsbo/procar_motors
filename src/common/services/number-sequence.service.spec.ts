import { Test, TestingModule } from '@nestjs/testing';
import { NumberSequenceService } from './number-sequence.service';
import { PrismaService } from '../../database/prisma.service';

describe('NumberSequenceService', () => {
  it('formats PREFIX-YYYY-#### and increments', async () => {
    const year = new Date().getFullYear();
    let next = 1;
    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<string>) => {
        const tx = {
          $executeRaw: () => Promise.resolve(0),
          $queryRaw: () =>
            Promise.resolve([
              {
                id: '1',
                value: {
                  JT: { prefix: 'JT', year, next },
                },
              },
            ]),
          jobTicket: {
            findFirst: () => Promise.resolve(null),
          },
          quotation: {
            findFirst: () => Promise.resolve(null),
          },
          workOrder: {
            findFirst: () => Promise.resolve(null),
          },
          purchaseRequest: {
            findFirst: () => Promise.resolve(null),
          },
          purchaseOrder: {
            findFirst: () => Promise.resolve(null),
          },
          goodsReceipt: {
            findFirst: () => Promise.resolve(null),
          },
          invoice: {
            findFirst: () => Promise.resolve(null),
          },
          payment: {
            findFirst: () => Promise.resolve(null),
          },
          systemSetting: {
            upsert: ({
              update,
            }: {
              update: { value: { JT: { next: number } } };
            }) => {
              next = update.value.JT.next;
              return Promise.resolve();
            },
          },
        };
        return fn(tx);
      },
    };

    const service = new NumberSequenceService(
      prisma as unknown as PrismaService,
    );
    const a = await service.next('org', 'JT');
    const b = await service.next('org', 'JT');
    expect(a).toBe(`JT-${year}-0001`);
    expect(b).toBe(`JT-${year}-0002`);
  });

  it('is provided by Nest DI', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NumberSequenceService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn() },
        },
      ],
    }).compile();
    expect(module.get(NumberSequenceService)).toBeDefined();
  });
});
