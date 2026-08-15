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
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { InspectionTemplatesService } from './inspection-templates.service';

class TemplateItemDto {
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
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  requiresMeasurement?: boolean;
}

class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items!: TemplateItemDto[];
}

class ListTemplatesQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean = true;
}

@ApiTags('inspection-templates')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('inspection-templates')
export class InspectionTemplatesController {
  constructor(private readonly templates: InspectionTemplatesService) {}

  @Get()
  @RequirePermissions('inspections.view')
  @ApiOperation({ summary: 'List inspection templates' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListTemplatesQueryDto,
  ) {
    return this.templates.list(user.orgId, query.activeOnly !== false);
  }

  @Get(':id')
  @RequirePermissions('inspections.view')
  @ApiOperation({ summary: 'Get inspection template' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Create inspection template' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user.orgId, user.sub, dto);
  }
}
