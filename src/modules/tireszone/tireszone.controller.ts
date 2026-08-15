import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipBranch } from '../rbac/decorators/rbac.decorators';

@ApiTags('tireszone')
@ApiBearerAuth()
@Controller('tireszone')
export class TireszoneController {
  @Get('health')
  @SkipBranch()
  @ApiOperation({ summary: 'TiresZone integration stub health' })
  health() {
    return {
      app: 'tireszone',
      status: 'stub',
      schema: 'tireszone',
      ready: true,
    };
  }
}
