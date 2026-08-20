export type JwtAccessPayload = {
  sub: string;
  orgId: string;
  userType: 'staff' | 'customer';
  roles: string[];
  branchIds: string[];
  /** Application codes this user may open — see core.user_app_access */
  apps: string[];
  /** Present for portal customer sessions */
  customerId?: string | null;
};

export type AuthUserContext = JwtAccessPayload & {
  email: string | null;
  permissions: string[];
};
