import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IntegrationService } from './integration.service';

class TireRequestDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) qty?: number;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class CafeLineDto {
  @IsUUID() variantId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(20) qty!: number;
}

class CafeOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CafeLineDto)
  items!: CafeLineDto[];
  @IsOptional() @IsString() @MaxLength(50) tableRef?: string;
}

@ApiTags('integration')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('integration')
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}

  @Get('visits/:visitId/context')
  @RequirePermissions('visits.view')
  @ApiOperation({
    summary: 'Everything happening for one visit, across all four applications',
  })
  context(
    @CurrentUser() user: AuthUserContext,
    @Param('visitId', ParseUUIDPipe) visitId: string,
  ) {
    return this.integration.visitContext(user.orgId, visitId);
  }

  @Post('visits/:visitId/tire-request')
  @RequirePermissions('inspections.update')
  @ApiOperation({
    summary: 'Raise a Tire Zone order from a workshop inspection',
  })
  requestTires(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: TireRequestDto,
  ) {
    return this.integration.requestTires(
      user.orgId,
      branchId!,
      user.sub,
      visitId,
      dto,
    );
  }

  @Post('visits/:visitId/cafe-order')
  @RequirePermissions('visits.update')
  @ApiOperation({
    summary: 'Take a Daily Cup order for a customer waiting on this visit',
  })
  cafeOrder(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CafeOrderDto,
  ) {
    return this.integration.orderFromCafe(
      user.orgId,
      branchId!,
      user.sub,
      visitId,
      dto,
    );
  }
}
