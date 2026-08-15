import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Public, SkipBranch } from '../rbac/decorators/rbac.decorators';
import { PortalAuthService } from './portal-auth.service';

class RequestOtpDto {
  @IsString()
  @MinLength(8)
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @MinLength(4)
  code!: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

@ApiTags('portal-auth')
@Controller('portal/auth')
@SkipBranch()
export class PortalAuthController {
  constructor(private readonly portalAuth: PortalAuthService) {}

  @Post('request-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @ApiOperation({ summary: 'Request portal OTP by phone (OQ-01)' })
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: { ip?: string }) {
    return this.portalAuth.requestOtp(dto.phone, req.ip);
  }

  @Post('verify-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @ApiOperation({ summary: 'Verify portal OTP and issue JWT' })
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: { ip?: string }) {
    return this.portalAuth.verifyOtp({
      phone: dto.phone,
      code: dto.code,
      deviceInfo: dto.deviceInfo,
      ip: req.ip,
    });
  }
}
