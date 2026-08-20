import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  RequirePermissions,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { EmployeesService } from './employees.service';

class ListEmployeesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() status?: string;
}

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @SkipBranch()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'Staff directory' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListEmployeesQuery,
  ) {
    return this.employees.list(user.orgId, query);
  }
}
