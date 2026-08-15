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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { QualityControlService } from './quality-control.service';

class CreateQcDto {
  @IsUUID()
  workOrderId!: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;
}

class QcItemPatchDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsBoolean()
  passed!: boolean | null;
}

class UpdateItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QcItemPatchDto)
  items!: QcItemPatchDto[];
}

class FailQcDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

@ApiTags('quality-control')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('quality-checks')
export class QualityControlController {
  constructor(private readonly qc: QualityControlService) {}

  @Get(':id')
  @RequirePermissions('qc.view')
  @ApiOperation({ summary: 'Get quality check detail' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qc.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('qc.create')
  @ApiOperation({ summary: 'Create QC checklist for a work order in QC' })
  create(@CurrentUser() user: AuthUserContext, @Body() dto: CreateQcDto) {
    return this.qc.create(user.orgId, user.sub, dto);
  }

  @Patch(':id/items')
  @RequirePermissions('qc.update')
  @ApiOperation({ summary: 'Update QC checklist item results' })
  updateItems(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemsDto,
  ) {
    return this.qc.updateItems(user.orgId, user.sub, id, dto.items);
  }

  @Post(':id/pass')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('qc.approve')
  @ApiOperation({ summary: 'Pass QC → visit readyForDelivery' })
  pass(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qc.pass(user.orgId, user.sub, id);
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('qc.reject')
  @ApiOperation({ summary: 'Fail QC → rework + visit inProgress' })
  fail(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailQcDto,
  ) {
    return this.qc.fail(user.orgId, user.sub, id, dto);
  }
}
