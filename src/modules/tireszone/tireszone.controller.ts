import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  RequireApp,
  RequirePermissions,
  SkipApp,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';

import type { AuthUserContext } from '../auth/auth.types';
import { TireszoneService } from './tireszone.service';

class ProductQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @Type(() => Number) @IsInt() width?: number;
  @IsOptional() @Type(() => Number) @IsInt() aspectRatio?: number;
  @IsOptional() @Type(() => Number) @IsInt() rimDiameter?: number;
  @IsOptional() @IsString() season?: string;
}

class CreateProductDto {
  @IsUUID() partId!: string;
  @IsString() @MinLength(1) @MaxLength(64) sku!: string;
  @IsString() @MinLength(1) nameEn!: string;
  @IsString() @MinLength(1) nameAr!: string;
  @IsString() @MinLength(1) brand!: string;
  @IsOptional() @IsString() pattern?: string;
  @Type(() => Number) @IsInt() @Min(100) @Max(500) width!: number;
  @Type(() => Number) @IsInt() @Min(20) @Max(100) aspectRatio!: number;
  @Type(() => Number) @IsInt() @Min(10) @Max(30) rimDiameter!: number;
  @IsOptional() @IsString() season?: string;
  @IsOptional() @IsString() speedRating?: string;
  @IsOptional() @IsString() loadIndex?: string;
  @IsOptional() @IsBoolean() runFlat?: boolean;
  @IsOptional() @IsString() dotWeek?: string;
  @IsOptional() @Type(() => Number) @IsInt() warrantyMonths?: number;
  @IsOptional() @Type(() => Number) @IsInt() warrantyKm?: number;
}

class FinderQueryDto {
  @IsString() @MinLength(1) make!: string;
  @IsString() @MinLength(1) model!: string;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
}

class OrderQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() channel?: string;
}

class CreateOrderDto {
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsOptional() @IsUUID() workOrderId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) odometer?: number;
  @IsOptional() @IsString() notes?: string;
}

class OrderLineDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @Type(() => Number) @IsNumber() @Min(0.001) qty!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
}

class SetItemsDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRatePct?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}

class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class AlignmentDto {
  @IsOptional() @IsObject() before?: Record<string, unknown>;
  @IsOptional() @IsObject() after?: Record<string, unknown>;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('tireszone')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@RequireApp('tirezone')
@Controller('tireszone')
export class TireszoneController {
  constructor(private readonly tires: TireszoneService) {}

  @Get('health')
  @SkipApp()
  @SkipBranch()
  @ApiOperation({ summary: 'Tire Zone module health' })
  health() {
    return { app: 'tirezone', status: 'ready', schema: 'tireszone' };
  }

  // ── Catalogue ──────────────────────────────────────────────────────────

  @Get('products')
  @RequirePermissions('parts.view')
  @ApiOperation({ summary: 'List tire products with live stock' })
  listProducts(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ProductQueryDto,
  ) {
    return this.tires.listProducts(user.orgId, query);
  }

  @Get('products/:id')
  @RequirePermissions('parts.view')
  @ApiOperation({ summary: 'Get one tire product' })
  getProduct(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tires.getProduct(user.orgId, id);
  }

  @Post('products')
  @RequirePermissions('parts.create')
  @ApiOperation({ summary: 'Register an inventory part as a tire product' })
  createProduct(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: CreateProductDto,
  ) {
    return this.tires.createProduct(user.orgId, user.sub, dto);
  }

  @Get('finder')
  @RequirePermissions('parts.view')
  @ApiOperation({ summary: 'Tire Finder — sizes and stock for a vehicle' })
  finder(
    @CurrentUser() user: AuthUserContext,
    @Query() query: FinderQueryDto,
  ) {
    return this.tires.findForVehicle(user.orgId, query);
  }

  @Get('services')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Fitting-bay services' })
  listServices(@CurrentUser() user: AuthUserContext) {
    return this.tires.listServices(user.orgId);
  }

  // ── Sales orders ───────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'List sales orders for the active branch' })
  listOrders(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: OrderQueryDto,
  ) {
    return this.tires.listOrders(user.orgId, branchId!, query);
  }

  @Get('orders/:id')
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'Get a sales order' })
  getOrder(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tires.getOrder(user.orgId, id);
  }

  @Post('orders')
  @RequirePermissions('invoices.create')
  @ApiOperation({ summary: 'Open a sales order' })
  createOrder(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    return this.tires.createOrder(user.orgId, branchId!, user.sub, dto);
  }

  @Put('orders/:id/items')
  @RequirePermissions('invoices.update')
  @ApiOperation({ summary: 'Replace the lines on a sales order' })
  setItems(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetItemsDto,
  ) {
    return this.tires.setOrderItems(user.orgId, branchId!, user.sub, id, dto);
  }

  @Post('orders/:id/complete')
  @RequirePermissions('invoices.create')
  @ApiOperation({
    summary: 'Complete the sale — issues stock and raises the invoice',
  })
  complete(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tires.completeOrder(user.orgId, branchId!, user.sub, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('invoices.cancel')
  @ApiOperation({ summary: 'Cancel an open sales order' })
  cancel(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.tires.cancelOrder(
      user.orgId,
      branchId!,
      user.sub,
      id,
      dto.reason,
    );
  }

  @Put('orders/:id/alignment')
  @RequirePermissions('work_orders.update')
  @ApiOperation({ summary: 'Record before/after wheel alignment readings' })
  alignment(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AlignmentDto,
  ) {
    return this.tires.recordAlignment(user.orgId, user.sub, id, dto);
  }
}
