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
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { SuppliersService } from './suppliers.service';

class ListSuppliersQuery {
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

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}

class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}

class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}

@ApiTags('suppliers')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.view')
  @ApiOperation({ summary: 'List suppliers' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListSuppliersQuery,
  ) {
    return this.suppliers.list(user.orgId, query);
  }

  @Get(':id')
  @RequirePermissions('suppliers.view')
  @ApiOperation({ summary: 'Get supplier' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.suppliers.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('suppliers.create')
  @ApiOperation({ summary: 'Create supplier' })
  create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliers.create(user.orgId, user.sub, branchId, dto);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.update')
  @ApiOperation({ summary: 'Update supplier' })
  update(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(user.orgId, user.sub, branchId, id, dto);
  }
}
