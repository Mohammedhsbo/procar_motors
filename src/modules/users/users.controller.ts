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
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
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
import { UserStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { UsersService } from './users.service';

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

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

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
  phone?: string;

  @IsString()
  roleKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branchIds!: string[];

  @IsOptional()
  @IsString()
  locale?: string;
}

class UpdateUserDto {
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
  phone?: string;

  @IsOptional()
  @IsString()
  roleKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branchIds?: string[];

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

@ApiTags('users')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'List staff users' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: PaginationQueryDto,
  ) {
    return this.users.list(user.orgId, query.page, query.limit);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'Get user by id' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Create staff user' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateUserDto) {
    return this.users.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Update staff user' })
  update(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user.orgId, user.sub, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Update user status (active/suspended)' })
  updateStatus(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(user.orgId, user.sub, id, dto.status);
  }
}
