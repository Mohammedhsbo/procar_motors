import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public, SkipBranch } from '../modules/rbac/decorators/rbac.decorators';
import { HealthService } from './health.service';
import { ErrorCodes } from '../common/constants/error-codes';

@ApiTags('health')
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @SkipBranch()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Public()
  @SkipBranch()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (database + redis)' })
  async getReady() {
    const result = await this.healthService.getReady();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: ErrorCodes.SERVICE_UNAVAILABLE,
        message: 'One or more dependencies are unavailable',
        details: result.checks,
      });
    }
    return result;
  }
}
