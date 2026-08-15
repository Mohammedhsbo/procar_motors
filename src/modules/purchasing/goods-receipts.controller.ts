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
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { GoodsReceiptsService } from './goods-receipts.service';

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

class ListGrnQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  poId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

class GrnItemDto {
  @IsUUID()
  poItemId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qtyReceived!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyRejected?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCostActual?: number;
}

class CreateGrnDto {
  @IsUUID()
  poId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrnItemDto)
  items!: GrnItemDto[];
}

@ApiTags('goods-receipts')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(
    private readonly receipts: GoodsReceiptsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermissions('goods_receipts.view')
  @ApiOperation({ summary: 'List goods receipts' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListGrnQuery,
  ) {
    return this.receipts.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('goods_receipts.view')
  @ApiOperation({ summary: 'Get goods receipt' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.receipts.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('goods_receipts.create')
  @ApiOperation({ summary: 'Create draft goods receipt' })
  async create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateGrnDto,
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
      const data = await this.receipts.create(
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
    return this.receipts.create(user.orgId, branchId!, user.sub, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('goods_receipts.receive')
  @ApiOperation({ summary: 'Post goods receipt into inventory (purchase_in)' })
  async receive(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey) {
      const hash = this.idempotency.hashRequest({ id });
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.receipts.receive(user.orgId, user.sub, id);
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
        responseStatus: 200,
        responseBody: data,
      });
      return data;
    }
    return this.receipts.receive(user.orgId, user.sub, id);
  }
}
