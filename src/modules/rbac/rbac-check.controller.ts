import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';

@ApiTags('rbac-check')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('rbac-check')
export class RbacCheckController {
  @Get('users-view')
  @RequirePermissions('users.view')
  @ApiOperation({
    summary: 'Protected probe requiring users.view (Phase 2 guard test)',
  })
  usersView(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return {
      ok: true,
      userId: user.sub,
      roles: user.roles,
      branchId,
      permission: 'users.view',
    };
  }

  @Get('branch-only')
  @ApiOperation({
    summary: 'Auth + branch scope probe (no extra permission)',
  })
  branchOnly(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return {
      ok: true,
      userId: user.sub,
      roles: user.roles,
      branchId,
    };
  }
}
