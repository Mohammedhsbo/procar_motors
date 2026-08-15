import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { RequirePermissions } from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { InvoicesService } from './invoices.service';

class ListInvoicesQuery {
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
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

class CreateInvoiceDto {
  @IsUUID()
  quotationId!: string;

  @IsOptional()
  @IsString()
  dueAt?: string;
}

class CancelInvoiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

class PayInvoiceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  paidAt?: string;
}

@ApiTags('invoices')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'List invoices' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListInvoicesQuery,
  ) {
    return this.invoices.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('invoices.view')
  @ApiOperation({ summary: 'Get invoice' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoices.getById(user.orgId, id);
  }

  @Post()
  @RequirePermissions('invoices.create')
  @ApiOperation({ summary: 'Create draft invoice from approved quotation' })
  async create(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Body() dto: CreateInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey) {
      const hash = this.idempotency.hashRequest(dto);
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.invoices.createFromQuotation(
        user.orgId,
        branchId!,
        user.sub,
        dto,
      );
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
        responseStatus: 201,
        responseBody: data,
      });
      return data;
    }
    return this.invoices.createFromQuotation(
      user.orgId,
      branchId!,
      user.sub,
      dto,
    );
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('invoices.create')
  @ApiOperation({ summary: 'Issue draft invoice' })
  issue(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoices.issue(user.orgId, user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('invoices.delete')
  @ApiOperation({ summary: 'Cancel unpaid draft/issued invoice' })
  cancel(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
  ) {
    return this.invoices.cancel(user.orgId, user.sub, id, dto);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.create')
  @ApiOperation({ summary: 'Record payment against invoice' })
  async pay(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (idempotencyKey) {
      const hash = this.idempotency.hashRequest({ id, ...dto });
      const replay = await this.idempotency.beginOrReplay({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
      });
      if (replay.replay) {
        res.status(replay.status);
        return replay.body;
      }
      const data = await this.invoices.pay(
        user.orgId,
        branchId!,
        user.sub,
        id,
        dto,
      );
      await this.idempotency.save({
        key: idempotencyKey,
        userId: user.sub,
        requestHash: hash,
        responseStatus: 200,
        responseBody: data,
      });
      return data;
    }
    return this.invoices.pay(user.orgId, branchId!, user.sub, id, dto);
  }
}
