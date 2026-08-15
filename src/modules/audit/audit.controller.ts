import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { AuditService } from './audit.service';

class AuditQueryDto {
  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

@ApiTags('audit')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'List audit logs' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: AuditQueryDto,
  ) {
    return this.audit.list({
      organizationId: user.orgId,
      branchId: user.roles.includes('super_admin') ? undefined : branchId,
      entity: query.entity,
      page: query.page,
      limit: query.limit,
    });
  }
}
