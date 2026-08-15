import { Module } from '@nestjs/common';
import { DailyCafeController } from './daily-cafe.controller';

@Module({
  controllers: [DailyCafeController],
})
export class DailyCafeModule {}
