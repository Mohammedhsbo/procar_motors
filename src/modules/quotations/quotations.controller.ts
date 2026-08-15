import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ApprovalActorType,
  QuotationItemKind,
  QuotationStatus,
} from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { QuotationsService } from './quotations.service';

class QuoteItemDto {
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

  @IsOptional()
  @IsUUID()
  partId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

class CreateQuotationDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items!: QuoteItemDto[];
}

class UpdateItemsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items!: QuoteItemDto[];
}

class DecisionDto {
  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsEnum(ApprovalActorType)
  actorType?: ApprovalActorType;
}

class ListQuotationsQueryDto {
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
  @IsEnum(QuotationStatus)
  status?: QuotationStatus;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

@ApiTags('quotations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermissions('quotations.view')
  @ApiOperation({ summary: 'List quotations' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListQuotationsQueryDto,
  ) {
    return this.quotations.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('quotations.view')
  @ApiOperation({ summary: 'Get quotation detail' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotations.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('quotations.create')
  @ApiOperation({ summary: 'Create draft quotation' })
  create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.quotations.create(user.orgId, branchId!, user.sub, dto);
  }

  @Patch(':id/items')
  @RequirePermissions('quotations.update')
  @ApiOperation({ summary: 'Replace quotation items (draft only)' })
  updateItems(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemsDto,
  ) {
    return this.quotations.updateItems(user.orgId, user.sub, id, dto);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotations.send')
  @ApiOperation({ summary: 'Send quotation for approval (→ pending)' })
  send(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotations.send(user.orgId, user.sub, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotations.approve')
  @ApiOperation({ summary: 'Approve quotation → visit readyForRepair' })
  approve(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.quotations.approve(user.orgId, user.sub, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotations.reject')
  @ApiOperation({ summary: 'Reject quotation (visit stays waitingApproval)' })
  reject(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.quotations.reject(user.orgId, user.sub, id, dto);
  }

  @Post(':id/request-changes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('quotations.reject')
  @ApiOperation({ summary: 'Request changes (quote → draft for edit)' })
  requestChanges(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.quotations.requestChanges(user.orgId, user.sub, id, dto);
  }

  @Post(':id/new-version')
  @RequirePermissions('quotations.update')
  @ApiOperation({ summary: 'Create new draft version; supersede previous' })
  newVersion(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotations.newVersion(user.orgId, user.sub, id);
  }
}
