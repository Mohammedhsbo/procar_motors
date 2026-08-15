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
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { BranchesService } from './branches.service';

class PaginationQueryDto {
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

class CreateBranchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameAr!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

class UpdateBranchDto {
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
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('branches')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('branches.view')
  @ApiOperation({ summary: 'List branches' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: PaginationQueryDto,
  ) {
    return this.branches.list(user.orgId, query.page, query.limit);
  }

  @Get(':id')
  @RequirePermissions('branches.view')
  @ApiOperation({ summary: 'Get branch by id' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branches.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('branches.create')
  @ApiOperation({ summary: 'Create branch' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateBranchDto) {
    return this.branches.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('branches.update')
  @ApiOperation({ summary: 'Update branch' })
  update(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(user.orgId, user.sub, id, dto);
  }
}
