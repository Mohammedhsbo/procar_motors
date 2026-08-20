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

export const APPS_KEY = 'apps';
/**
 * Restrict a route to users granted access to one of the given applications.
 * Codes come from `core.applications` — see common/constants/applications.ts.
 */
export const RequireApp = (...apps: string[]) => SetMetadata(APPS_KEY, apps);

export const SKIP_APP_KEY = 'skipApp';
/**
 * Exempt a route from its controller's `@RequireApp`. Used for diagnostics
 * such as `/health`, which any authenticated staff member may read.
 */
export const SkipApp = () => SetMetadata(SKIP_APP_KEY, true);

export const USER_TYPES_KEY = 'userTypes';
/** Restrict route to specific JWT userType values (e.g. customer portal). */
export const RequireUserTypes = (...types: Array<'staff' | 'customer'>) =>
  SetMetadata(USER_TYPES_KEY, types);
