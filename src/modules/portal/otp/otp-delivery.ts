/**
 * Provider-ready OTP delivery. Plug a real SMS vendor later without
 * changing the portal auth flow. No vendor SDK in this phase.
 */
export const OTP_DELIVERY = Symbol('OTP_DELIVERY');

export type OtpDeliveryMessage = {
  phone: string;
  code: string;
  customerId: string;
};

export interface OtpDeliveryProvider {
  sendOtp(message: OtpDeliveryMessage): Promise<void>;
}
