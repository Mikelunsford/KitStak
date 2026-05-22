/**
 * Payment query keys.
 */

import type { ListPaymentsFilters } from '@/lib/services/paymentsService';

export const paymentKeys = {
  all: ['invoicing', 'payments'] as const,
  list: (filters: ListPaymentsFilters = {}) =>
    ['invoicing', 'payments', 'list', filters] as const,
  detail: (id: string) => ['invoicing', 'payments', 'detail', id] as const,
  // BNEW-10: dedicated cache key for per-invoice payment lookups. Used as
  // an invalidation target by the create/apply mutations so the invoice
  // detail page's payments section refetches after the operator receives
  // a payment. The list query above still keys by raw filters (we keep
  // the existing surface) so this is purely additive.
  byInvoice: (invoiceId: string) =>
    ['invoicing', 'payments', 'byInvoice', invoiceId] as const,
};
