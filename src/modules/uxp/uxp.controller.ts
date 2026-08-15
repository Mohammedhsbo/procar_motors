import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipBranch } from '../rbac/decorators/rbac.decorators';

@ApiTags('uxp')
@ApiBearerAuth()
@Controller('uxp')
export class UxpController {
  @Get('health')
  @SkipBranch()
  @ApiOperation({ summary: 'UXP integration stub health' })
  health() {
    return { app: 'uxp', status: 'stub', schema: 'uxp', ready: true };
  }
}
