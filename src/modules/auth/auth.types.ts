export type JwtAccessPayload = {
  sub: string;
  orgId: string;
  userType: 'staff' | 'customer';
  roles: string[];
  branchIds: string[];
  /** Present for portal customer sessions */
  customerId?: string | null;
};

export type AuthUserContext = JwtAccessPayload & {
  email: string | null;
  permissions: string[];
};
