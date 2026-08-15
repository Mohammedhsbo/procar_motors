import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { TaxesService } from './taxes.service';

@ApiTags('taxes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('taxes')
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get()
  @RequirePermissions('taxes.view')
  @ApiOperation({ summary: 'List tax rates' })
  list(@CurrentUser() user: AuthUserContext) {
    return this.taxes.list(user.orgId);
  }
}
