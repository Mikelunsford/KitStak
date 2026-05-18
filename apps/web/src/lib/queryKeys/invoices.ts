/**
 * Invoice query keys. Shape: ['invoicing', 'invoices', ...args].
 * Hooks always build keys through this factory; never inline.
 */

import type { ListInvoicesFilters } from '@/lib/services/invoicesService';

export const invoiceKeys = {
  all: ['invoicing', 'invoices'] as const,
  list: (filters: ListInvoicesFilters = {}) =>
    ['invoicing', 'invoices', 'list', filters] as const,
  detail: (id: string) => ['invoicing', 'invoices', 'detail', id] as const,
  lineItems: (invoiceId: string) =>
    ['invoicing', 'invoices', 'line-items', invoiceId] as const,
};
