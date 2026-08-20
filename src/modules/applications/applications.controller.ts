import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { APP_CODES } from '../../common/constants/applications';
import {
  RequirePermissions,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ApplicationsService } from './applications.service';

class GrantAppDto {
  @IsIn(APP_CODES as unknown as string[])
  application!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class BranchAppDto {
  @IsIn(APP_CODES as unknown as string[])
  application!: string;

  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get('mine')
  @SkipBranch()
  @ApiOperation({ summary: 'Applications the current user may open' })
  mine(@CurrentUser() user: AuthUserContext) {
    return this.applications.listMine(user.sub, user.orgId, user.roles);
  }

  @Get()
  @SkipBranch()
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'All registered applications' })
  list(@CurrentUser() user: AuthUserContext) {
    return this.applications.list(user.orgId);
  }

  @Get('branches/:branchId')
  @SkipBranch()
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Applications enabled at a branch' })
  forBranch(
    @CurrentUser() user: AuthUserContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.applications.listForBranch(user.orgId, branchId);
  }

  @Put('branches/:branchId')
  @SkipBranch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Enable or disable an application at a branch' })
  setBranch(
    @CurrentUser() user: AuthUserContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: BranchAppDto,
  ) {
    return this.applications.setBranchApplication(
      user.orgId,
      branchId,
      dto.application,
      dto.enabled,
    );
  }

  @Get('users/:userId')
  @SkipBranch()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'Applications granted to a user' })
  forUser(
    @CurrentUser() user: AuthUserContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.applications.listForUser(user.orgId, userId);
  }

  @Post('users/:userId')
  @SkipBranch()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'Grant a user access to an application' })
  grant(
    @CurrentUser() user: AuthUserContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantAppDto,
  ) {
    return this.applications.grant(
      user.orgId,
      user.sub,
      userId,
      dto.application,
      dto.isDefault ?? false,
    );
  }

  @Delete('users/:userId/:application')
  @SkipBranch()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'Revoke a user’s access to an application' })
  revoke(
    @CurrentUser() user: AuthUserContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('application') application: string,
  ) {
    return this.applications.revoke(user.orgId, userId, application);
  }
}
