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
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InspectionResultState, QuotationItemKind } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { InspectionsService } from './inspections.service';

class CreateInspectionDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ResultItemDto {
  @IsUUID()
  templateItemId!: string;

  @IsEnum(InspectionResultState)
  state!: InspectionResultState;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  measurement?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  photoFileIds?: string[];
}

class UpdateResultsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResultItemDto)
  results!: ResultItemDto[];
}

class CreateFindingDto {
  @IsString()
  @MinLength(1)
  titleEn!: string;

  @IsString()
  @MinLength(1)
  titleAr!: string;

  @IsOptional()
  @IsString()
  causeEn?: string;

  @IsOptional()
  @IsString()
  causeAr?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  recommendedActionEn?: string;

  @IsOptional()
  @IsString()
  recommendedActionAr?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}

class RecommendedItemDto {
  @IsEnum(QuotationItemKind)
  kind!: QuotationItemKind;

  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

class CompleteInspectionDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendedItemDto)
  recommendedItems?: RecommendedItemDto[];
}

class ListInspectionsQueryDto {
  @IsOptional()
  @IsUUID()
  visitId?: string;
}

@ApiTags('inspections')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  @RequirePermissions('inspections.view')
  @ApiOperation({ summary: 'List inspections (filter by visitId)' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListInspectionsQueryDto,
  ) {
    if (!query.visitId) {
      return [];
    }
    return this.inspections.listByVisit(user.orgId, query.visitId);
  }

  @Get(':id')
  @RequirePermissions('inspections.view')
  @ApiOperation({ summary: 'Get inspection detail with checklist + findings' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inspections.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('inspections.create')
  @ApiOperation({ summary: 'Start inspection for a visit' })
  create(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: CreateInspectionDto,
  ) {
    return this.inspections.create(user.orgId, user.sub, dto);
  }

  @Patch(':id/results')
  @RequirePermissions('inspections.update')
  @ApiOperation({ summary: 'Upsert checklist results' })
  updateResults(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResultsDto,
  ) {
    return this.inspections.updateResults(
      user.orgId,
      user.sub,
      id,
      dto.results,
    );
  }

  @Post(':id/findings')
  @RequirePermissions('inspections.update')
  @ApiOperation({ summary: 'Add inspection finding (diagnosed problem)' })
  addFinding(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFindingDto,
  ) {
    return this.inspections.addFinding(user.orgId, user.sub, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('inspections.complete')
  @ApiOperation({
    summary: 'Complete inspection → draft quotation + waitingApproval',
  })
  complete(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteInspectionDto,
  ) {
    return this.inspections.complete(user.orgId, user.sub, id, dto);
  }
}
