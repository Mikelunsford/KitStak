/**
 * Identity / me query keys.
 *
 * Shape: `[module, entity, ...args]`. Build keys through this factory;
 * never inline in components.
 */
export const meKeys = {
  all: ['identity', 'me'] as const,
};
