import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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
import { JobTicketsService } from './job-tickets.service';

class ListTicketsQueryDto {
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

  @IsOptional()
  @IsString()
  status?: string;
}

@ApiTags('job-tickets')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('job-tickets')
export class JobTicketsController {
  constructor(private readonly tickets: JobTicketsService) {}

  @Get()
  @RequirePermissions('tickets.view')
  @ApiOperation({ summary: 'List job tickets' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListTicketsQueryDto,
  ) {
    return this.tickets.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('tickets.view')
  @ApiOperation({ summary: 'Get job ticket by id' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.getById(user.orgId, id);
  }
}
