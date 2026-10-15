/**
 * Server-derived Super Admin hint for UI rendering only.
 *
 * The backend computes this from its centralized SUPER_ADMIN_EMAIL rule and
 * enforces every real permission. The browser must never derive or grant this
 * identity from an email string.
 */
export interface SuperAdminHint {
  isSuperAdmin?: boolean;
}

export function isSuperAdminHint(user?: SuperAdminHint | null): boolean {
  return user?.isSuperAdmin === true;
}

/** UI helper for controls that the backend permits to either admin class. */
export function hasPlatformAdminAccess(
  role?: string | null,
  user?: SuperAdminHint | null
): boolean {
  return String(role || "").trim().toLowerCase() === "admin" || isSuperAdminHint(user);
}
