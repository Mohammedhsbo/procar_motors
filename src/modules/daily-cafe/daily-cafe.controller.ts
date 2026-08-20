import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  IsIn,
  IsInt,
  IsNumber,
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
import { DailyCafeService } from './daily-cafe.service';

class OrderQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() type?: string;
}

class OrderLineDto {
  @IsUUID() variantId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) qty!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) modifierCodes?: string[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class CreateOrderDto {
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'waiting_area']) type?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsOptional() @IsString() @MaxLength(50) tableRef?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRatePct?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}

class OpenSessionDto {
  @Type(() => Number) @IsNumber() @Min(0) openingFloat!: number;
}

class CloseSessionDto {
  @Type(() => Number) @IsNumber() @Min(0) closingCount!: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class WasteDto {
  @IsUUID() partId!: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) qty!: number;
  @IsString() @MinLength(1) unit!: string;
  @IsString() @MinLength(1) @MaxLength(200) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@ApiTags('daily-cafe')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@RequireApp('dailycup')
@Controller('daily-cafe')
export class DailyCafeController {
  constructor(private readonly cafe: DailyCafeService) {}

  @Get('health')
  @SkipApp()
  @SkipBranch()
  @ApiOperation({ summary: 'Daily Cup module health' })
  health() {
    return { app: 'dailycup', status: 'ready', schema: 'daily_cafe' };
  }

  // ── Menu ───────────────────────────────────────────────────────────────

  @Get('menu')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'POS menu — categories, products and sizes' })
  menu(@CurrentUser() user: AuthUserContext) {
    return this.cafe.menu(user.orgId);
  }

  @Get('categories')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Menu categories' })
  categories(@CurrentUser() user: AuthUserContext) {
    return this.cafe.listCategories(user.orgId);
  }

  @Get('modifiers')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Available modifiers' })
  modifiers(@CurrentUser() user: AuthUserContext) {
    return this.cafe.listModifiers(user.orgId);
  }

  // ── Costing ────────────────────────────────────────────────────────────

  @Get('recipes/:id/cost')
  @RequirePermissions('reports.finance')
  @ApiOperation({ summary: 'Ingredient breakdown and cost per unit' })
  recipeCost(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cafe.recipeCost(user.orgId, id);
  }

  @Get('costing')
  @RequirePermissions('reports.finance')
  @ApiOperation({ summary: 'Cost, price and margin for every menu item' })
  costing(@CurrentUser() user: AuthUserContext) {
    return this.cafe.costingReport(user.orgId);
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'List orders for the active branch' })
  listOrders(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: OrderQueryDto,
  ) {
    return this.cafe.listOrders(user.orgId, branchId!, query);
  }

  @Get('kitchen')
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'Kitchen display queue — oldest first' })
  kitchen(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return this.cafe.kitchenQueue(user.orgId, branchId!);
  }

  @Post('orders')
  @RequirePermissions('invoices.create')
  @ApiOperation({
    summary: 'Take an order — prices it, freezes cost and depletes stock',
  })
  createOrder(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    return this.cafe.createOrder(user.orgId, branchId!, user.sub, dto);
  }

  @Post('orders/:id/ready')
  @RequirePermissions('invoices.update')
  @ApiOperation({ summary: 'Mark an order ready for collection' })
  ready(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cafe.markReady(user.orgId, id);
  }

  @Post('orders/:id/close')
  @RequirePermissions('invoices.create')
  @ApiOperation({ summary: 'Close the order and invoice it if it has a customer' })
  close(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cafe.closeOrder(user.orgId, branchId!, user.sub, id);
  }

  // ── Cash sessions ──────────────────────────────────────────────────────

  @Post('sessions/open')
  @RequirePermissions('payments.create')
  @ApiOperation({ summary: 'Open the cash drawer for a shift' })
  openSession(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: OpenSessionDto,
  ) {
    return this.cafe.openSession(
      user.orgId,
      branchId!,
      user.sub,
      dto.openingFloat,
    );
  }

  @Post('sessions/:id/close')
  @RequirePermissions('payments.create')
  @ApiOperation({ summary: 'Close the drawer and record the variance' })
  closeSession(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.cafe.closeSession(
      user.orgId,
      user.sub,
      id,
      dto.closingCount,
      dto.notes,
    );
  }

  // ── Waste ──────────────────────────────────────────────────────────────

  @Post('waste')
  @RequirePermissions('inventory.consume')
  @ApiOperation({ summary: 'Log spoilage — depletes stock and hits profit' })
  waste(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: WasteDto,
  ) {
    return this.cafe.logWaste(user.orgId, branchId!, user.sub, dto);
  }
}
