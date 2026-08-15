import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { PurchaseRequestStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { PurchaseRequestsService } from './purchase-requests.service';

class PageQuery {
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
  limit?: number = 50;
}

class ListPrQuery extends PageQuery {
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  status?: PurchaseRequestStatus;

  @IsOptional()
  @IsUUID()
  quotationId?: string;
}

class PrItemDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreatePrDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID()
  quotationId?: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PrItemDto)
  items!: PrItemDto[];
}

class FromUnavailableDto {
  @IsUUID()
  quotationId!: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoSubmit?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PrItemDto)
  items!: PrItemDto[];
}

class ReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

@ApiTags('purchase-requests')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(
    private readonly prs: PurchaseRequestsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermissions('purchase_requests.view')
  @ApiOperation({ summary: 'List purchase requests' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListPrQuery,
  ) {
    return this.prs.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('purchase_requests.view')
  @ApiOperation({ summary: 'Get purchase request' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prs.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('purchase_requests.create')
  @ApiOperation({ summary: 'Create draft purchase request' })
  async create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreatePrDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey) {
      const hash = this.idempotency.hashRequest(dto);
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.prs.create(user.orgId, branchId!, user.sub, dto);
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
        responseStatus: 201,
        responseBody: data,
      });
      return data;
    }
    return this.prs.create(user.orgId, branchId!, user.sub, dto);
  }

  @Post('from-unavailable')
  @RequirePermissions('purchase_requests.create')
  @ApiOperation({
    summary:
      'Create PR from quotation unavailable parts (Phase 11 deferred hook)',
  })
  async fromUnavailable(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: FromUnavailableDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey) {
      const hash = this.idempotency.hashRequest(dto);
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.prs.createFromUnavailable(
        user.orgId,
        branchId!,
        user.sub,
        dto,
      );
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
        responseStatus: 201,
        responseBody: data,
      });
      return data;
    }
    return this.prs.createFromUnavailable(user.orgId, branchId!, user.sub, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_requests.create')
  @ApiOperation({ summary: 'Submit PR for approval' })
  submit(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prs.submit(user.orgId, user.sub, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_requests.approve')
  @ApiOperation({ summary: 'Approve purchase request' })
  approve(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prs.approve(user.orgId, user.sub, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_requests.reject')
  @ApiOperation({ summary: 'Reject purchase request' })
  reject(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.prs.reject(user.orgId, user.sub, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_requests.cancel')
  @ApiOperation({ summary: 'Cancel purchase request' })
  cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.prs.cancel(user.orgId, user.sub, id, dto);
  }
}
