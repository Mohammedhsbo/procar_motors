import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { PaymentsService } from './payments.service';

class ListPaymentsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}

@ApiTags('payments')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'List payments' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListPaymentsQuery,
  ) {
    return this.payments.list(user.orgId, branchId!, query);
  }
}
