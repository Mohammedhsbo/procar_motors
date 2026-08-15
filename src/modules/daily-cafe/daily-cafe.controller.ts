import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipBranch } from '../rbac/decorators/rbac.decorators';

@ApiTags('daily-cafe')
@ApiBearerAuth()
@Controller('daily-cafe')
export class DailyCafeController {
  @Get('health')
  @SkipBranch()
  @ApiOperation({ summary: 'Daily Cafe integration stub health' })
  health() {
    return {
      app: 'daily_cafe',
      status: 'stub',
      schema: 'daily_cafe',
      ready: true,
    };
  }
}
