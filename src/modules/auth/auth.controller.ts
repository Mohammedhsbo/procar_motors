import { Body, Controller, Get, Headers, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Public,
  RequireUserTypes,
  SkipBranch,
} from '../rbac/decorators/rbac.decorators';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import { AuthService } from './auth.service';
import type { AuthUserContext } from './auth.types';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @Post('login')
  @ApiOperation({ summary: 'Staff login' })
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('x-forwarded-for') forwarded?: string,
  ) {
    const clientIp = forwarded?.split(',')[0]?.trim() || ip;
    return this.authService.login({
      email: dto.email,
      password: dto.password,
      deviceInfo: dto.deviceInfo,
      ip: clientIp,
    });
  }

  @Public()
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.authService.refresh(dto.refreshToken, ip);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @SkipBranch()
  @RequireUserTypes('staff', 'customer')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user profile' })
  me(@CurrentUser() user: AuthUserContext) {
    return this.authService.me(user.sub);
  }

  @Public()
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset (stub)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    auth: { limit: 5, ttl: 60_000 },
  })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password (stub)' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    void dto;
    return {
      message: 'Password reset is not fully implemented yet (Phase 2 stub).',
    };
  }
}
