import { Module } from '@nestjs/common';
import { TireszoneController } from './tireszone.controller';

@Module({
  controllers: [TireszoneController],
})
export class TireszoneModule {}
