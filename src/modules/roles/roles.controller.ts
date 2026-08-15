import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { RolesService } from './roles.service';

class UpdateRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];
}

@ApiTags('roles')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'List roles' })
  list(@CurrentUser() user: AuthUserContext) {
    return this.roles.list(user.orgId);
  }

  @Get(':id/permissions')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Get role permission matrix' })
  getPermissions(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roles.getPermissions(user.orgId, id);
  }

  @Patch(':id/permissions')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Update role permission matrix' })
  updatePermissions(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.roles.updatePermissions(
      user.orgId,
      user.sub,
      id,
      dto.permissionKeys,
    );
  }
}
