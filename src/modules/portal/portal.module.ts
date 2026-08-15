import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { OTP_DELIVERY } from './otp/otp-delivery';
import { DevLogOtpProvider } from './otp/dev-log-otp.provider';

@Module({
  imports: [AuthModule, AuditModule, QuotationsModule],
  controllers: [PortalAuthController, PortalController],
  providers: [
    { provide: OTP_DELIVERY, useClass: DevLogOtpProvider },
    PortalAuthService,
    PortalService,
  ],
  exports: [PortalService],
})
export class PortalModule {}
