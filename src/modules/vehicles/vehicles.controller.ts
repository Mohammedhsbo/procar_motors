import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FuelType, TransmissionType } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { VehiclesService } from './vehicles.service';

class ListVehiclesQueryDto {
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
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['plate', 'make', 'year', 'createdAt'])
  sortBy?: 'plate' | 'make' | 'year' | 'createdAt' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';
}

class CreateVehicleDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  plate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  engineNumber?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  make!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  model!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @IsOptional()
  @IsEnum(TransmissionType)
  transmission?: TransmissionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileageCurrent?: number;
}

class UpdateVehicleDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vin?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  engineNumber?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  make?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string | null;

  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType | null;

  @IsOptional()
  @IsEnum(TransmissionType)
  transmission?: TransmissionType | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileageCurrent?: number | null;

  @IsOptional()
  @IsString()
  status?: string;
}

@ApiTags('vehicles')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions('vehicles.view')
  @ApiOperation({ summary: 'List vehicles' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListVehiclesQueryDto,
  ) {
    return this.vehicles.list(user.orgId, query);
  }

  @Get(':id')
  @RequirePermissions('vehicles.view')
  @ApiOperation({ summary: 'Get vehicle detail with profile tabs' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehicles.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('vehicles.create')
  @ApiOperation({ summary: 'Create vehicle' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('vehicles.update')
  @ApiOperation({ summary: 'Update vehicle' })
  update(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(user.orgId, user.sub, id, dto);
  }
}
