import {
  BadRequestException,
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
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CustomerStatus,
  FuelType,
  Priority,
  TransmissionType,
  VisitStatus,
} from '@prisma/client';
import type { Response } from 'express';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../rbac/decorators/rbac.decorators';
import { BranchId, CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ErrorCodes } from '../../common/constants/error-codes';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { VehicleVisitsService } from './vehicle-visits.service';

class NewCustomerDto {
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

class NewVehicleDto {
  @IsString()
  @MinLength(2)
  plate!: string;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  engineNumber?: string;

  @IsString()
  @MinLength(1)
  make!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @IsOptional()
  @IsEnum(TransmissionType)
  transmission?: TransmissionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileageCurrent?: number;
}

class DamagePointDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  xPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  yPct!: number;

  @IsString()
  @MinLength(1)
  labelEn!: string;

  @IsString()
  @MinLength(1)
  labelAr!: string;

  @IsOptional()
  @IsString()
  severity?: string;
}

class CheckInBodyDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerDto)
  newCustomer?: NewCustomerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewVehicleDto)
  newVehicle?: NewVehicleDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  mileage!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  fuelLevelPct!: number;

  @IsOptional()
  @IsString()
  exteriorCondition?: string;

  @IsString()
  @MinLength(1)
  complaint!: string;

  @IsEnum(Priority)
  priority!: Priority;

  @IsString()
  expectedDeliveryAt!: string;

  @IsOptional()
  @IsUUID()
  advisorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DamagePointDto)
  damagePoints?: DamagePointDto[];
}

class TransitionBodyDto {
  @IsEnum(VisitStatus)
  status!: VisitStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

class DeliverBodyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overridePayment?: boolean;

  @IsOptional()
  @IsString()
  overrideReason?: string;
}

class ListVisitsQueryDto {
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
  limit?: number = 20;

  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

@ApiTags('vehicle-visits')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller('vehicle-visits')
export class VehicleVisitsController {
  constructor(
    private readonly visits: VehicleVisitsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @RequirePermissions('visits.view')
  @ApiOperation({ summary: 'List vehicle visits' })
  list(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Query() query: ListVisitsQueryDto,
  ) {
    return this.visits.list(user.orgId, branchId!, query);
  }

  @Get(':id')
  @RequirePermissions('visits.view')
  @ApiOperation({ summary: 'Get visit detail' })
  get(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.visits.getById(user.orgId, id);
  }

  @Post('check-in')
  @RequirePermissions('visits.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Reception check-in wizard' })
  async checkIn(
    @CurrentUser() user: AuthUserContext,
    @BranchId() branchId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CheckInBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Idempotency-Key header is required',
      });
    }

    const requestHash = this.idempotency.hashRequest(body);
    const replay = await this.idempotency.beginOrReplay({
      key: idempotencyKey,
      userId: user.sub,
      requestHash,
    });
    if (replay.replay) {
      res.status(replay.status);
      return replay.body;
    }

    const data = await this.visits.checkIn(
      user.orgId,
      branchId!,
      user.sub,
      body,
    );

    await this.idempotency.save({
      key: idempotencyKey,
      userId: user.sub,
      requestHash,
      responseStatus: 201,
      responseBody: data,
    });

    res.status(201);
    return data;
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermissions('board.move', 'visits.update')
  @ApiOperation({ summary: 'Transition visit status (board drag/drop)' })
  transition(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionBodyDto,
  ) {
    return this.visits.transition(user.orgId, user.sub, id, body);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('visits.complete')
  @ApiOperation({
    summary:
      'Deliver vehicle (readyForDelivery → completed); payment required unless manager override',
  })
  deliver(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeliverBodyDto,
  ) {
    return this.visits.deliver(user.orgId, user.sub, user, id, body);
  }
}
