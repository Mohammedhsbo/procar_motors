import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RequirePermissions,
  RequireUserTypes,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { PortalService } from './portal.service';

class ApproveRejectDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

class FeedbackDto {
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsString()
  @MinLength(2)
  comment!: string;
}

@ApiTags('portal')
@ApiBearerAuth()
@Controller('portal')
@SkipBranch()
@RequireUserTypes('customer')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('vehicles')
  @RequirePermissions('portal.view')
  @ApiOperation({ summary: 'List my vehicles' })
  vehicles(@CurrentUser() user: AuthUserContext) {
    return this.portal.listVehicles(user);
  }

  @Get('visits/:id/status')
  @RequirePermissions('portal.view')
  @ApiOperation({ summary: 'Visit status timeline for portal' })
  visitStatus(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.visitStatus(user, id);
  }

  @Get('quotations/:id')
  @RequirePermissions('portal.view')
  @ApiOperation({ summary: 'Get my quotation' })
  quotation(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.getQuotation(user, id);
  }

  @Post('quotations/:id/approve')
  @RequirePermissions('portal.approve')
  @ApiOperation({ summary: 'Approve my quotation' })
  approve(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRejectDto,
  ) {
    return this.portal.approveQuotation(user, id, dto.comment);
  }

  @Post('quotations/:id/reject')
  @RequirePermissions('portal.reject')
  @ApiOperation({ summary: 'Reject my quotation' })
  reject(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRejectDto,
  ) {
    return this.portal.rejectQuotation(user, id, dto.comment);
  }

  @Get('invoices')
  @RequirePermissions('portal.view')
  @ApiOperation({ summary: 'List my invoices' })
  invoices(@CurrentUser() user: AuthUserContext) {
    return this.portal.listInvoices(user);
  }

  @Get('service-history')
  @RequirePermissions('portal.view')
  @ApiOperation({ summary: 'My service history' })
  history(@CurrentUser() user: AuthUserContext) {
    return this.portal.serviceHistory(user);
  }

  @Post('feedback')
  @RequirePermissions('portal.create')
  @ApiOperation({ summary: 'Submit portal feedback' })
  feedback(@CurrentUser() user: AuthUserContext, @Body() dto: FeedbackDto) {
    return this.portal.submitFeedback(user, dto);
  }
}
