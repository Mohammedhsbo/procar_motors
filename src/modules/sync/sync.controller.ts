import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { SyncService } from './sync.service';

class SyncOperationDto {
  @IsString()
  @MinLength(8)
  operationId!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsString()
  @MinLength(1)
  action!: string;

  @IsISO8601()
  clientTimestamp!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

class SyncBatchDto {
  @IsString()
  @MinLength(4)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations!: SyncOperationDto[];
}

class SyncStatusQuery {
  @IsOptional()
  @IsString()
  clientId?: string;
}

@ApiTags('sync')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('batch')
  @RequirePermissions('visits.create')
  @ApiOperation({ summary: 'Apply offline reception sync batch' })
  batch(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Body() dto: SyncBatchDto,
  ) {
    return this.sync.processBatch({
      organizationId: user.orgId,
      branchId,
      actorId: user.sub,
      clientId: dto.clientId,
      operations: dto.operations,
    });
  }

  @Get('status/:operationId')
  @ApiOperation({ summary: 'Get sync operation status' })
  status(
    @CurrentUser() user: AuthUserContext,
    @Param('operationId') operationId: string,
    @Query() query: SyncStatusQuery,
  ) {
    return this.sync.getStatus({
      organizationId: user.orgId,
      actorId: user.sub,
      roles: user.roles,
      operationId,
      clientId: query.clientId,
    });
  }
}
