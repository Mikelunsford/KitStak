/**
 * Tenants / tenant-resolve / tenant-me query keys.
 *
 * Shape: `[module, entity, ...args]`.
 */
export const tenantsKeys = {
  all: ['tenancy', 'tenants'] as const,
  me: ['tenancy', 'tenants', 'me'] as const,
  branding: ['tenancy', 'tenants', 'branding'] as const,
  resolveHost: (host: string) => ['tenancy', 'tenants', 'resolveHost', host] as const,
};
