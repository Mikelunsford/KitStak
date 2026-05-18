/**
 * Payment query keys.
 */

import type { ListPaymentsFilters } from '@/lib/services/paymentsService';

export const paymentKeys = {
  all: ['invoicing', 'payments'] as const,
  list: (filters: ListPaymentsFilters = {}) =>
    ['invoicing', 'payments', 'list', filters] as const,
  detail: (id: string) => ['invoicing', 'payments', 'detail', id] as const,
};
