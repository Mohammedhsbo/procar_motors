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
} from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { UxbService } from './uxb.service';

class JobQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() search?: string;
}

class CreateJobDto {
  @IsUUID() customerId!: string;
  @IsUUID() vehicleId!: string;
  @IsOptional() @IsUUID() sizeClassId?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsOptional() @IsUUID() advisorId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) odometer?: number;
  @IsOptional() @IsString() @MaxLength(2000) complaint?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() promisedAt?: string;
}

class JobLineDto {
  @IsUUID() serviceId!: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) areaSqm?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) qty?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsUUID() technicianId?: string;
}

class SetJobItemsDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRatePct?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JobLineDto)
  items!: JobLineDto[];
}

class AdvanceDto {
  @IsIn([
    'inspection',
    'in_progress',
    'quality',
    'ready',
    'delivered',
    'cancelled',
  ])
  stage!: string;
}

class ZoneDto {
  @IsString() @MinLength(1) status!: string;
  @IsOptional() @IsString() filmType?: string;
  @IsOptional() @IsString() notes?: string;
}

class ReadingDto {
  @IsString() @MinLength(1) panelCode!: string;
  @Type(() => Number) @IsNumber() @Min(0) thicknessUm!: number;
  @IsOptional() @IsString() notes?: string;
}

class OpenRollDto {
  @IsUUID() partId!: string;
  @IsString() @MinLength(1) rollNo!: string;
  @Type(() => Number) @IsNumber() @Min(1) widthCm!: number;
  @Type(() => Number) @IsNumber() @Min(0.1) initialM!: number;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costPerM?: number;
}

class ConsumeRollDto {
  @IsUUID() rollId!: string;
  @IsUUID() jobItemId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) metersUsed!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) wasteM?: number;
}

@ApiTags('uxb')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@RequireApp('uxb')
@Controller('uxb')
export class UxbController {
  constructor(private readonly uxb: UxbService) {}

  // ── Catalogue ──────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Service categories' })
  categories(@CurrentUser() user: AuthUserContext) {
    return this.uxb.listCategories(user.orgId);
  }

  @Get('size-classes')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Vehicle size classes used for pricing' })
  sizeClasses(@CurrentUser() user: AuthUserContext) {
    return this.uxb.listSizeClasses(user.orgId);
  }

  @Get('services')
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Services with per-size pricing' })
  services(
    @CurrentUser() user: AuthUserContext,
    @Query('category') category?: string,
  ) {
    return this.uxb.listServices(user.orgId, category);
  }

  // ── Jobs ───────────────────────────────────────────────────────────────

  @Get('board')
  @RequirePermissions('board.view')
  @ApiOperation({ summary: 'Shop-floor board grouped by stage' })
  board(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
  ) {
    return this.uxb.board(user.orgId, branchId!);
  }

  @Get('jobs')
  @RequirePermissions('visits.view')
  @ApiOperation({ summary: 'List jobs for the active branch' })
  listJobs(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: JobQueryDto,
  ) {
    return this.uxb.listJobs(user.orgId, branchId!, query);
  }

  @Get('jobs/:id')
  @RequirePermissions('visits.view')
  @ApiOperation({ summary: 'Get a job with items, zones and readings' })
  getJob(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.uxb.getJob(user.orgId, id);
  }

  @Post('jobs')
  @RequirePermissions('visits.create')
  @ApiOperation({ summary: 'Open a job' })
  createJob(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateJobDto,
  ) {
    return this.uxb.createJob(user.orgId, branchId!, user.sub, dto);
  }

  @Put('jobs/:id/items')
  @RequirePermissions('visits.update')
  @ApiOperation({ summary: 'Replace the service lines on a job' })
  setItems(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetJobItemsDto,
  ) {
    return this.uxb.setJobItems(user.orgId, branchId!, user.sub, id, dto);
  }

  @Post('jobs/:id/advance')
  @RequirePermissions('visits.update')
  @ApiOperation({ summary: 'Move the job to the next stage' })
  advance(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceDto,
  ) {
    return this.uxb.advanceJob(user.orgId, branchId!, user.sub, id, dto.stage);
  }

  @Post('jobs/:id/invoice')
  @RequirePermissions('invoices.create')
  @ApiOperation({ summary: 'Invoice a completed job into the shared ledger' })
  invoice(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.uxb.invoiceJob(user.orgId, branchId!, user.sub, id);
  }

  @Get('jobs/:id/profitability')
  @RequirePermissions('reports.finance')
  @ApiOperation({ summary: 'Revenue, material cost and margin for a job' })
  profitability(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.uxb.jobProfitability(user.orgId, id);
  }

  // ── Panel map and readings ─────────────────────────────────────────────

  @Put('jobs/:id/zones/:panelCode')
  @RequirePermissions('visits.update')
  @ApiOperation({ summary: 'Set the coverage state of one panel' })
  setZone(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('panelCode') panelCode: string,
    @Body() dto: ZoneDto,
  ) {
    return this.uxb.setZoneStatus(user.orgId, id, panelCode, dto);
  }

  @Post('jobs/:id/readings')
  @RequirePermissions('visits.update')
  @ApiOperation({ summary: 'Record a paint thickness reading' })
  addReading(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReadingDto,
  ) {
    return this.uxb.addPaintReading(user.orgId, user.sub, id, dto);
  }

  // ── Material rolls ─────────────────────────────────────────────────────

  @Get('rolls')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Film and PPF rolls at the active branch' })
  listRolls(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query('status') status?: string,
  ) {
    return this.uxb.listRolls(user.orgId, branchId!, status);
  }

  @Post('rolls')
  @RequirePermissions('inventory.create')
  @ApiOperation({ summary: 'Open a new roll' })
  openRoll(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: OpenRollDto,
  ) {
    return this.uxb.openRoll(user.orgId, branchId!, user.sub, dto);
  }

  @Post('rolls/consume')
  @RequirePermissions('inventory.consume')
  @ApiOperation({ summary: 'Draw metres off a roll for a job line' })
  consume(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: ConsumeRollDto,
  ) {
    return this.uxb.consumeRoll(user.orgId, user.sub, dto);
  }
}
