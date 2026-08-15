import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { BranchGuard } from './guards/branch.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { UserTypeGuard } from './guards/user-type.guard';
import { RbacCheckController } from './rbac-check.controller';

@Module({
  imports: [AuthModule],
  controllers: [RbacCheckController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: UserTypeGuard },
    { provide: APP_GUARD, useClass: BranchGuard },
  ],
})
export class RbacModule {}
