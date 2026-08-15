import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ErrorCodes } from '../../common/constants/error-codes';
import { ReportsService, type ReportKind } from './reports.service';

class ReportRangeQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** super_admin only: `all` aggregates across branches */
  @IsOptional()
  @IsString()
  branchId?: string;
}

class ExportReportDto {
  @IsIn([
    'workshop',
    'financial',
    'inventory',
    'technician-performance',
    'analytics',
  ])
  kind!: ReportKind;

  @IsIn(['csv', 'pdf'])
  format!: 'csv' | 'pdf';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}

@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('workshop')
  @RequirePermissions('reports.workshop')
  @ApiOperation({ summary: 'Workshop throughput report' })
  workshop(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ReportRangeQuery,
  ) {
    return this.reports.workshop(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('financial')
  @RequirePermissions('reports.finance')
  @ApiOperation({ summary: 'Financial report' })
  financial(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ReportRangeQuery,
  ) {
    return this.reports.financial(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('inventory')
  @RequirePermissions('reports.inventory')
  @ApiOperation({ summary: 'Inventory stock report' })
  inventory(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ReportRangeQuery,
  ) {
    return this.reports.inventory(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('technician-performance')
  @RequirePermissions('reports.workshop')
  @ApiOperation({ summary: 'Technician performance report' })
  technicianPerformance(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ReportRangeQuery,
  ) {
    return this.reports.technicianPerformance(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('analytics')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Cross-domain analytics summary' })
  analytics(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ReportRangeQuery,
  ) {
    return this.reports.analytics(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Post('export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Enqueue CSV/PDF report export' })
  export(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Body() dto: ExportReportDto,
  ) {
    this.assertExportKindPermission(user, dto.kind);
    return this.reports.enqueueExport({
      organizationId: user.orgId,
      branchId,
      scope: this.resolveScope(user, branchId, dto.branchId),
      kind: dto.kind,
      format: dto.format,
      requestedBy: user.sub,
      from: dto.from,
      to: dto.to,
    });
  }

  @Get('export/:jobId')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Poll report export job status/result' })
  getExport(@Param('jobId') jobId: string) {
    return this.reports.getExport(jobId);
  }

  private resolveScope(
    user: AuthUserContext,
    headerBranchId: string,
    queryBranchId?: string,
  ): { mode: 'one'; branchId: string } | { mode: 'all' } {
    if (queryBranchId === 'all') {
      if (!user.roles.includes('super_admin')) {
        throw new ForbiddenException({
          code: ErrorCodes.FORBIDDEN,
          message: 'branchId=all requires super_admin',
        });
      }
      return { mode: 'all' };
    }
    return { mode: 'one', branchId: headerBranchId };
  }

  private assertExportKindPermission(user: AuthUserContext, kind: ReportKind) {
    if (user.roles.includes('super_admin')) return;
    if (kind === 'analytics' && !user.permissions.includes('reports.view')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'reports.view required for analytics export',
      });
    }
    if (
      (kind === 'workshop' || kind === 'technician-performance') &&
      !user.permissions.includes('reports.workshop')
    ) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'reports.workshop required',
      });
    }
    if (kind === 'financial' && !user.permissions.includes('reports.finance')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'reports.finance required',
      });
    }
    if (
      kind === 'inventory' &&
      !user.permissions.includes('reports.inventory')
    ) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'reports.inventory required',
      });
    }
  }
}
