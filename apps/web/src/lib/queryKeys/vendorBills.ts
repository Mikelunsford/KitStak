export const vendorBillsKeys = {
  all: ['vendors', 'vendor_bills'] as const,
  list: () => [...vendorBillsKeys.all, 'list'] as const,
  detail: (id: string) => [...vendorBillsKeys.all, 'detail', id] as const,
  payments: (id: string) => [...vendorBillsKeys.all, 'payments', id] as const,
};
