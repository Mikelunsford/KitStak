/**
 * Feature-flag admin query keys.
 *
 * Shape: `[module, entity, ...args]`.
 */
export const flagsKeys = {
  all: ['flags'] as const,
  list: ['flags', 'list'] as const,
};
