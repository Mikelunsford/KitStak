/**
 * Session / switch-org query keys.
 *
 * Shape: `[module, entity, ...args]`. Build keys through this factory; never
 * inline in components.
 */
export const sessionKeys = {
  all: ['identity', 'session'] as const,
  capabilities: ['identity', 'session', 'capabilities'] as const,
};
