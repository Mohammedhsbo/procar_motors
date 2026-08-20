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
  IsEmail,
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
import { CustomerStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { CustomersService } from './customers.service';
import { Customer360Service } from './customer-360.service';

class ListCustomersQueryDto {
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
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['nameEn', 'createdAt', 'updatedAt'])
  sortBy?: 'nameEn' | 'createdAt' | 'updatedAt' = 'nameEn';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'asc';
}

class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameAr!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  preferredBranchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;
}

class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  preferredBranchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;
}

@ApiTags('customers')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly customer360: Customer360Service,
  ) {}

  @Get()
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'List customers' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListCustomersQueryDto,
  ) {
    return this.customers.list(user.orgId, query);
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'Get customer by id' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.getById(user.orgId, id);
  }

  @Get(':id/360')
  @RequirePermissions('customers.view')
  @ApiOperation({
    summary: 'Customer 360 — activity and spend across all four applications',
  })
  overview(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customer360.get(user.orgId, id);
  }

  @Get(':id/vehicles')
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'List vehicles for a customer' })
  listVehicles(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.listVehicles(user.orgId, id);
  }

  @Post()
  @RequirePermissions('customers.create')
  @ApiOperation({ summary: 'Create customer' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  @ApiOperation({ summary: 'Update customer' })
  update(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user.orgId, user.sub, id, dto);
  }
}
