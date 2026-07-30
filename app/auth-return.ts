export const DEFAULT_AUTH_RETURN = "/";
export const PROFILE_AUTH_RETURN = "/?screen=profile";

/**
 * Keep authentication handoffs same-origin and limited to product destinations
 * that are meaningful after an account transition.
 */
export function safeAuthReturn(
  value: string | string[] | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === PROFILE_AUTH_RETURN) return PROFILE_AUTH_RETURN;
  return DEFAULT_AUTH_RETURN;
}

export function authDestination(
  pathname: "/sign-in" | "/auth/connected",
  returnTo: string,
): string {
  const safeReturn = safeAuthReturn(returnTo);
  if (safeReturn === DEFAULT_AUTH_RETURN) return pathname;
  return `${pathname}?returnTo=${encodeURIComponent(safeReturn)}`;
}
