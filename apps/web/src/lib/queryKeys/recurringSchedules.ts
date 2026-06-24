/**
 * Recurring schedule query keys. Shape:
 * ['invoicing', 'recurring-schedules', ...args].
 * Hooks always build keys through this factory; never inline.
 */

import type { ListRecurringSchedulesFilters } from '@/lib/services/recurringSchedulesService';

export const recurringScheduleKeys = {
  all: ['invoicing', 'recurring-schedules'] as const,
  list: (filters: ListRecurringSchedulesFilters = {}) =>
    ['invoicing', 'recurring-schedules', 'list', filters] as const,
  byProject: (projectId: string) =>
    ['invoicing', 'recurring-schedules', 'project', projectId] as const,
};
