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
import { WorkshopBoardService } from './workshop-board.service';

@ApiTags('workshop-board')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('workshop')
export class WorkshopBoardController {
  constructor(private readonly board: WorkshopBoardService) {}

  @Get('board')
  @RequirePermissions('board.view')
  @ApiOperation({ summary: 'Workshop kanban board by visit status' })
  getBoard(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return this.board.getBoard(user.orgId, branchId!);
  }
}
