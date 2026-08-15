import { Injectable, Logger } from '@nestjs/common';
import type { OtpDeliveryMessage, OtpDeliveryProvider } from './otp-delivery';

/**
 * Development/test delivery: logs the OTP. Does not send SMS.
 * Replace via OTP_DELIVERY provider when a vendor is chosen.
 */
@Injectable()
export class DevLogOtpProvider implements OtpDeliveryProvider {
  private readonly logger = new Logger(DevLogOtpProvider.name);

  sendOtp(message: OtpDeliveryMessage): Promise<void> {
    this.logger.log(
      `OTP delivery (log-only) customer=${message.customerId} phone=${message.phone} code=${message.code}`,
    );
    return Promise.resolve();
  }
}
