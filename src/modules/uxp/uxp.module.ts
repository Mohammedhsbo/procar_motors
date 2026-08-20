import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UxbController } from './uxb.controller';
import { UxbService } from './uxb.service';
import { UxpController } from './uxp.controller';

@Module({
  imports: [AuditModule],
  controllers: [UxpController, UxbController],
  providers: [UxbService],
  exports: [UxbService],
})
export class UxpModule {}
