import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DashboardService } from './dashboard.service';

class ActivitiesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

class ScopeQuery {
  /** super_admin only: pass `all` to aggregate across branches */
  @IsOptional()
  @IsString()
  branchId?: string;
}

@ApiTags('dashboard')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Dashboard KPI summary (8 KPIs)' })
  summary(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ScopeQuery,
  ) {
    return this.dashboard.summary(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('revenue-overview')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Revenue vs expenses last 7 days' })
  revenueOverview(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ScopeQuery,
  ) {
    return this.dashboard.revenueOverview(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('workshop-status')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Visit status distribution' })
  workshopStatus(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ScopeQuery,
  ) {
    return this.dashboard.workshopStatus(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('monthly-revenue')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Monthly revenue (6 months)' })
  monthlyRevenue(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ScopeQuery,
  ) {
    return this.dashboard.monthlyRevenue(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('tech-productivity')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Technician productivity (30 days)' })
  techProductivity(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ScopeQuery,
  ) {
    return this.dashboard.techProductivity(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
    );
  }

  @Get('recent-activities')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Recent audit activities' })
  recentActivities(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string,
    @Query() query: ActivitiesQuery & ScopeQuery,
  ) {
    return this.dashboard.recentActivities(
      user.orgId,
      this.resolveScope(user, branchId, query.branchId),
      query.limit ?? 20,
    );
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
}
