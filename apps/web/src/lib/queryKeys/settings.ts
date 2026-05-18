/**
 * Settings / numbering / branding-write query keys.
 *
 * Shape: `[module, entity, ...args]`.
 */
export const settingsKeys = {
  all: ['settings'] as const,
  list: ['settings', 'list'] as const,
  group: (group: string) => ['settings', 'list', group] as const,
  branding: ['settings', 'branding'] as const,
  numbering: ['settings', 'numbering'] as const,
  numberingOne: (docType: string) => ['settings', 'numbering', docType] as const,
};
