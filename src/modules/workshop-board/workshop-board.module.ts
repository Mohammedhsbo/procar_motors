import { Module } from '@nestjs/common';
import { WorkshopBoardController } from './workshop-board.controller';
import { WorkshopBoardService } from './workshop-board.service';

@Module({
  controllers: [WorkshopBoardController],
  providers: [WorkshopBoardService],
  exports: [WorkshopBoardService],
})
export class WorkshopBoardModule {}
