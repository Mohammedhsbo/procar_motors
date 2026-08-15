import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';
import { WorkshopGateway } from './workshop.gateway';
import { WorkshopRealtimeService } from './workshop-realtime.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [WorkshopGateway, WorkshopRealtimeService],
  exports: [WorkshopGateway, WorkshopRealtimeService],
})
export class RealtimeModule {}
