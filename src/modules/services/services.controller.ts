import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  RequirePermissions,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ServicesService } from './services.service';

class ListServicesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}

class CreateServiceDto {
  @IsString() @MinLength(1) @MaxLength(32) code!: string;
  @IsString() @MinLength(1) @MaxLength(160) nameEn!: string;
  @IsString() @MinLength(1) @MaxLength(160) nameAr!: string;
  @Type(() => Number) @IsNumber() @Min(0) laborPrice!: number;
  @Type(() => Number) @IsInt() @Min(1) durationMinutes!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) nameAr?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) laborPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) durationMinutes?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @SkipBranch()
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'List labour services' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListServicesQuery,
  ) {
    return this.services.list(user.orgId, query);
  }

  @Get(':id')
  @SkipBranch()
  @RequirePermissions('services.view')
  @ApiOperation({ summary: 'Get one service' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.getById(user.orgId, id);
  }

  @Post()
  @SkipBranch()
  @RequirePermissions('services.create')
  @ApiOperation({ summary: 'Create a service' })
  create(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: CreateServiceDto,
  ) {
    return this.services.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  @SkipBranch()
  @RequirePermissions('services.update')
  @ApiOperation({ summary: 'Update a service' })
  update(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(user.orgId, user.sub, id, dto);
  }

  @Delete(':id')
  @SkipBranch()
  @RequirePermissions('services.delete')
  @ApiOperation({ summary: 'Retire a service (soft delete)' })
  remove(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.remove(user.orgId, user.sub, id);
  }
}
