/**
 * Tenants/branding query keys.
 *
 * Shape: `[module, entity, ...args]`. Build keys through this factory;
 * never inline in components.
 */
export const brandingKeys = {
  all: ['tenants', 'branding'] as const,
};
