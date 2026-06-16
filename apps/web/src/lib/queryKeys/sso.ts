/**
 * SSO connection query keys. R-W13-AUTH-01.
 *
 * Shape: `[module, entity, ...args]`.
 */
export const ssoKeys = {
  all: ['sso'] as const,
  list: ['sso', 'connections'] as const,
};
