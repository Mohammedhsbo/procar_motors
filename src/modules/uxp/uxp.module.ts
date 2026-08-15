import { Module } from '@nestjs/common';
import { UxpController } from './uxp.controller';

@Module({
  controllers: [UxpController],
})
export class UxpModule {}
