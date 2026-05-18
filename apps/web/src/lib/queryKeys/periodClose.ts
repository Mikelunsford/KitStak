/**
 * Period close query keys.
 */

export const periodCloseKeys = {
  all: ['finance', 'period-close'] as const,
  list: (opts: { year?: number } = {}) =>
    ['finance', 'period-close', 'list', opts] as const,
};
