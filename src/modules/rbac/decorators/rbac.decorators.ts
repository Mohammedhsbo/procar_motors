import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Pass if the user has ANY of the listed permissions */
export const PERMISSIONS_ANY_KEY = 'permissions_any';
export const RequireAnyPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);

export const SKIP_BRANCH_KEY = 'skipBranch';
export const SkipBranch = () => SetMetadata(SKIP_BRANCH_KEY, true);

export const USER_TYPES_KEY = 'userTypes';
/** Restrict route to specific JWT userType values (e.g. customer portal). */
export const RequireUserTypes = (...types: Array<'staff' | 'customer'>) =>
  SetMetadata(USER_TYPES_KEY, types);
