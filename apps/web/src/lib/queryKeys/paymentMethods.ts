export const paymentMethodsKeys = {
  all: ['sales', 'payment_methods'] as const,
  list: () => ['sales', 'payment_methods', 'list'] as const,
  byId: (id: string) => ['sales', 'payment_methods', 'byId', id] as const,
};
