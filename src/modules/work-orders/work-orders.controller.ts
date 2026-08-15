import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Priority, WorkOrderStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { WorkOrdersService } from './work-orders.service';

class ListWorkOrdersQueryDto {
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
  @IsEnum(WorkOrderStatus)
  status?: WorkOrderStatus;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;
}

class TaskInputDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}

class CreateWorkOrderDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskInputDto)
  tasks?: TaskInputDto[];
}

class AssignDto {
  @IsUUID()
  technicianId!: string;

  @IsOptional()
  @IsUUID()
  bayId?: string;
}

class CancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class AdditionalIssueDto {
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
  @Type(() => Number)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}

@ApiTags('work-orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  @RequirePermissions('work_orders.view')
  @ApiOperation({ summary: 'List work orders' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListWorkOrdersQueryDto,
  ) {
    return this.workOrders.list(user.orgId, branchId!, query, user);
  }

  @Get(':id')
  @RequirePermissions('work_orders.view')
  @ApiOperation({ summary: 'Get work order detail' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.getById(user.orgId, id, user);
  }

  @Post()
  @RequirePermissions('work_orders.create')
  @ApiOperation({ summary: 'Create work order for a visit' })
  create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.workOrders.create(user.orgId, branchId!, user.sub, dto);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.assign')
  @ApiOperation({ summary: 'Assign technician to work order' })
  assign(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.workOrders.assign(user.orgId, user.sub, id, dto);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.update')
  @ApiOperation({ summary: 'Start work order (visit → inProgress)' })
  start(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.start(user.orgId, user.sub, id, user);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.update')
  @ApiOperation({ summary: 'Pause work order' })
  pause(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.pause(user.orgId, user.sub, id, user);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.complete')
  @ApiOperation({ summary: 'Complete all tasks / mark work finished' })
  complete(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.complete(user.orgId, user.sub, id, user);
  }

  @Post(':id/send-to-qc')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.complete')
  @ApiOperation({ summary: 'Send to QC (visit → qualityCheck)' })
  sendToQc(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workOrders.sendToQc(user.orgId, user.sub, id, user);
  }

  @Post(':id/additional-issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tasks.create')
  @ApiOperation({
    summary: 'Report additional issue → pause WO + pending quotation',
  })
  additionalIssue(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdditionalIssueDto,
  ) {
    return this.workOrders.additionalIssue(user.orgId, user.sub, id, dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('work_orders.cancel')
  @ApiOperation({ summary: 'Cancel work order' })
  cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.workOrders.cancel(user.orgId, user.sub, id, dto);
  }
}
