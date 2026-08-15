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
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { ReservationStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { InventoryService } from './inventory.service';
import { ReservationService } from './reservation.service';

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

class BalancesQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(['ok', 'low', 'out'] as const)
  status?: 'ok' | 'low' | 'out';
}

class ReserveDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsUUID()
  workOrderId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;
}

class ConsumeDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty?: number;
}

class AdjustDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  qtyDelta!: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCost?: number;
}

class TransferDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsUUID()
  fromWarehouseId!: string;

  @IsUUID()
  toWarehouseId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ReturnDto {
  @IsUUID()
  partId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsUUID()
  workOrderId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('inventory')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly reservations: ReservationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('summary')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Inventory KPI summary for branch' })
  summary(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return this.inventory.summary(user.orgId, branchId!);
  }

  @Get('balances')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Stock balances for branch warehouses' })
  balances(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: BalancesQuery,
  ) {
    return this.inventory.balances(user.orgId, branchId!, query);
  }

  @Get('transactions')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Inventory ledger' })
  transactions(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: PageQuery & { partId?: string; type?: string },
  ) {
    return this.inventory.transactions(user.orgId, branchId!, query);
  }

  @Get('alerts')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Stock alerts' })
  alerts(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: PageQuery & { status?: string },
  ) {
    return this.inventory.alerts(user.orgId, branchId!, query);
  }

  @Get('reservations')
  @RequirePermissions('reservations.view')
  @ApiOperation({ summary: 'List stock reservations' })
  listReservations(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query()
    query: PageQuery & {
      status?: ReservationStatus;
      workOrderId?: string;
      partId?: string;
    },
  ) {
    return this.reservations.list(user.orgId, branchId!, query);
  }

  @Post('reservations')
  @RequirePermissions('reservations.create')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Reserve stock for a work order' })
  async reserve(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: ReserveDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey?.trim()) {
      const requestHash = this.idempotency.hashRequest(dto);
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.reservations.reserve(
        user.orgId,
        branchId!,
        user.sub,
        dto,
      );
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash,
        responseStatus: 201,
        responseBody: data,
      });
      res.status(201);
      return data;
    }
    res.status(201);
    return this.reservations.reserve(user.orgId, branchId!, user.sub, dto);
  }

  @Post('reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservations.release')
  release(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.reservations.release(user.orgId, user.sub, id, dto);
  }

  @Post('reservations/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservations.release')
  cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.reservations.cancel(user.orgId, user.sub, id, dto);
  }

  @Post('reservations/:id/consume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservations.consume')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async consume(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsumeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey?.trim()) {
      const requestHash = this.idempotency.hashRequest({ id, ...dto });
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.reservations.consume(
        user.orgId,
        user.sub,
        id,
        dto,
      );
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash,
        responseStatus: 200,
        responseBody: data,
      });
      return data;
    }
    return this.reservations.consume(user.orgId, user.sub, id, dto);
  }

  @Post('returns')
  @RequirePermissions('reservations.consume')
  @ApiOperation({ summary: 'Return unused parts from WO to stock' })
  returnParts(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: ReturnDto,
  ) {
    return this.reservations.returnToStock(
      user.orgId,
      branchId!,
      user.sub,
      dto,
    );
  }

  @Post('adjustments')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'Stock count adjustment' })
  adjust(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: AdjustDto,
  ) {
    return this.inventory.adjust(user.orgId, branchId!, user.sub, dto);
  }

  @Post('transfers')
  @RequirePermissions('inventory.transfer')
  @ApiOperation({ summary: 'Transfer stock between warehouses' })
  transfer(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: TransferDto,
  ) {
    return this.inventory.transfer(user.orgId, branchId!, user.sub, dto);
  }
}
