import type { ListVendorBillsFilters } from '@/lib/services/vendorBillsService';

export const vendorBillsKeys = {
  all: ['vendors', 'vendor_bills'] as const,
  list: (filters: ListVendorBillsFilters = {}) =>
    [...vendorBillsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...vendorBillsKeys.all, 'detail', id] as const,
  payments: (id: string) => [...vendorBillsKeys.all, 'payments', id] as const,
};
