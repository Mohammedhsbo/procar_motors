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
import { PurchaseOrderStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { PurchaseOrdersService } from './purchase-orders.service';

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

class ListPoQuery extends PageQuery {
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

class PoItemDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qtyOrdered!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

class CreatePoDto {
  @IsUUID()
  supplierId!: string;

  @IsOptional()
  @IsUUID()
  purchaseRequestId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoSubmit?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  items?: PoItemDto[];
}

class ReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

@ApiTags('purchase-orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermissions('purchase_orders.view')
  @ApiOperation({ summary: 'List purchase orders' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListPoQuery,
  ) {
    return this.orders.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('purchase_orders.view')
  @ApiOperation({ summary: 'Get purchase order' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('purchase_orders.create')
  @ApiOperation({ summary: 'Create purchase order (optionally from PR)' })
  async create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreatePoDto,
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
      const data = await this.orders.create(
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
    return this.orders.create(user.orgId, branchId!, user.sub, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_orders.create')
  @ApiOperation({ summary: 'Submit PO for approval' })
  submit(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.submit(user.orgId, user.sub, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_orders.approve')
  @ApiOperation({ summary: 'Approve purchase order' })
  approve(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.approve(user.orgId, user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase_orders.cancel')
  @ApiOperation({ summary: 'Cancel purchase order' })
  cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.cancel(user.orgId, user.sub, id, dto);
  }
}
