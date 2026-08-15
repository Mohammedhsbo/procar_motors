import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { SettingsService } from './settings.service';

class CompanyPatchDto {
  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

class WorkingHoursDto {
  @IsString()
  start!: string;

  @IsString()
  end!: string;
}

class NotificationsPatchDto {
  @IsOptional()
  @IsBoolean()
  lowStockAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  customerApprovalAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryDelayAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  dailyEmailDigest?: boolean;
}

class UpdateSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyPatchDto)
  company?: CompanyPatchDto;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultTaxRate?: number;

  @IsOptional()
  @IsString()
  invoicePrefix?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationsPatchDto)
  notifications?: NotificationsPatchDto;
}

@ApiTags('settings')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Get organization settings' })
  get(@CurrentUser() user: AuthUserContext) {
    return this.settings.get(user.orgId);
  }

  @Patch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Update organization settings' })
  update(@CurrentUser() user: AuthUserContext, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(user.orgId, user.sub, dto);
  }
}
