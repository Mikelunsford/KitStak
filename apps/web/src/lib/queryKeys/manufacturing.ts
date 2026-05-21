// Manufacturing query keys factory. Path A5 of the Manufacturing wiring plan.
// Pillar 2. Keyed under ['manufacturing', 'runs', ...].
//
// auditLogKeys.byEntity('manufacturing_run', id) is owned by the audit_log
// factory and is invalidated alongside these on mutation success.

import type { ListManufacturingRunsFilters } from '@/lib/services/manufacturingService';

export const manufacturingRunsKeys = {
  all: ['manufacturing', 'runs'] as const,
  list: (filters: ListManufacturingRunsFilters = {}) =>
    [...manufacturingRunsKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...manufacturingRunsKeys.all, 'detail', id] as const,
  consumed: (id: string) =>
    [...manufacturingRunsKeys.all, 'detail', id, 'consumed'] as const,
  produced: (id: string) =>
    [...manufacturingRunsKeys.all, 'detail', id, 'produced'] as const,
};
