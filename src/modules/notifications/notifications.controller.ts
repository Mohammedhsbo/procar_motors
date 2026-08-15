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
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RequirePermissions,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

class ListNotificationsQuery {
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
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

class PreferenceItemDto {
  @IsString()
  channel!: string;

  @IsString()
  eventKey!: string;

  @Type(() => Boolean)
  @IsBoolean()
  enabled!: boolean;
}

class UpsertPreferencesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences!: PreferenceItemDto[];
}

@ApiTags('notifications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: false })
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @RequirePermissions('notifications.view')
  @ApiOperation({ summary: 'List my notifications' })
  list(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListNotificationsQuery,
  ) {
    return this.notifications.list(user.sub, query);
  }

  @Patch('notifications/:id/read')
  @RequirePermissions('notifications.view')
  @ApiOperation({ summary: 'Mark notification as read' })
  markRead(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.sub, id);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.view')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@CurrentUser() user: AuthUserContext) {
    return this.notifications.markAllRead(user.sub);
  }

  @Get('notification-preferences')
  @SkipBranch()
  @ApiOperation({ summary: 'Get my notification preferences' })
  getPreferences(@CurrentUser() user: AuthUserContext) {
    return this.notifications.getPreferences(user.sub);
  }

  @Patch('notification-preferences')
  @SkipBranch()
  @ApiOperation({ summary: 'Upsert notification preferences' })
  upsertPreferences(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: UpsertPreferencesDto,
  ) {
    return this.notifications.upsertPreferences(user.sub, dto.preferences);
  }
}
