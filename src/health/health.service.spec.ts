import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'REDIS_URL') {
                return 'redis://127.0.0.1:6379';
              }
              return undefined;
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('getHealth returns ok', () => {
    expect(service.getHealth()).toEqual({ status: 'ok' });
  });
});
