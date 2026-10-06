/**
 * Client-side Super Admin hint (UI gating ONLY).
 * Every real permission check happens server-side — this constant never
 * grants anything by itself; it only decides which controls are rendered.
 */
export const SUPER_ADMIN_EMAIL = "devanshsinghr00@gmail.com";

export function isSuperAdminEmail(email?: string | null): boolean {
  return Boolean(email) && String(email).toLowerCase() === SUPER_ADMIN_EMAIL;
}
