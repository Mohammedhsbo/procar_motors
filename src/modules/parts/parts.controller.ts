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
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { PartsService } from './parts.service';

class ListPartsQuery {
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
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

class CreatePartDto {
  @IsString()
  @MinLength(1)
  sku!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice!: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  oemNumber?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initialQty?: number;

  @IsOptional()
  @IsString()
  binLocation?: string;
}

class UpdatePartDto {
  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  oemNumber?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('parts')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('parts')
export class PartsController {
  constructor(private readonly parts: PartsService) {}

  @Get()
  @RequirePermissions('parts.view')
  @ApiOperation({ summary: 'List parts catalog with branch stock' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListPartsQuery,
  ) {
    return this.parts.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('parts.view')
  get(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.parts.getById(user.orgId, branchId!, id);
  }

  @Post()
  @RequirePermissions('parts.create')
  create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreatePartDto,
  ) {
    return this.parts.create(user.orgId, branchId!, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('parts.update')
  update(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartDto,
  ) {
    return this.parts.update(user.orgId, branchId!, user.sub, id, dto);
  }
}
