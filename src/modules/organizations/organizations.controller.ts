import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipBranch } from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  @SkipBranch()
  @ApiOperation({ summary: 'Get current organization profile' })
  me(@CurrentUser() user: AuthUserContext) {
    return this.organizations.getById(user.orgId);
  }
}
