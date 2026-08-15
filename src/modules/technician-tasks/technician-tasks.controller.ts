import {
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
import { TechnicianTaskStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { TechnicianTasksService } from './technician-tasks.service';

class ListMyTasksQueryDto {
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
  @IsEnum(TechnicianTaskStatus)
  status?: TechnicianTaskStatus;
}

@ApiTags('technician-tasks')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller()
export class TechnicianTasksController {
  constructor(private readonly tasks: TechnicianTasksService) {}

  @Get('my-tasks')
  @RequirePermissions('tasks.view')
  @ApiOperation({ summary: 'List my assigned technician tasks' })
  myTasks(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListMyTasksQueryDto,
  ) {
    return this.tasks.myTasks(user.orgId, branchId!, user, query);
  }

  @Get('technician-tasks/:id')
  @RequirePermissions('tasks.view')
  @ApiOperation({ summary: 'Get technician task detail' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.getById(user.orgId, id, user);
  }

  @Post('technician-tasks/:id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tasks.complete')
  @ApiOperation({ summary: 'Start task timer' })
  start(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.start(user.orgId, user.sub, id, user);
  }

  @Post('technician-tasks/:id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tasks.complete')
  @ApiOperation({ summary: 'Pause task timer' })
  pause(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.pause(user.orgId, user.sub, id, user);
  }

  @Post('technician-tasks/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tasks.complete')
  @ApiOperation({ summary: 'Complete technician task' })
  complete(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.complete(user.orgId, user.sub, id, user);
  }
}
