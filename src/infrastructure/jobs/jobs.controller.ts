import {
  Controller,
  Post,
  Param,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RequirePermissions,
  SkipBranch,
} from '../../modules/rbac/decorators/rbac.decorators';
import { CurrentUser } from '../../modules/rbac/decorators/request.decorators';
import type { AuthUserContext } from '../../modules/auth/auth.types';
import { ErrorCodes } from '../../common/constants/error-codes';
import { JobsSchedulerService } from './jobs-scheduler.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsSchedulerService) {}

  @Post('run/:kind')
  @HttpCode(HttpStatus.OK)
  @SkipBranch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Manually run a background job (admin)' })
  async run(@CurrentUser() user: AuthUserContext, @Param('kind') kind: string) {
    if (!user.roles.includes('super_admin')) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'super_admin required',
      });
    }
    if (
      kind !== 'quotation-expiry' &&
      kind !== 'low-stock-scan' &&
      kind !== 'outbox-drain'
    ) {
      throw new ForbiddenException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Unknown job kind',
      });
    }
    return this.jobs.runNow(kind);
  }
}
