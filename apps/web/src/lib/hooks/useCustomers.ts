import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { customersKeys } from '@/lib/queryKeys/customers';
import {
  createCustomer,
  inviteCustomerToPortal,
  listCustomers,
  type InviteToPortalResult,
  type ListCustomersFilters,
} from '@/lib/services/customersService';
import type { Customer, CustomerCreate } from '@/lib/types/crm';

export function useCustomers(filters: ListCustomersFilters = {}) {
  return useQuery({
    queryKey: customersKeys.list(filters as Record<string, unknown>),
    queryFn: () => listCustomers(filters),
    staleTime: 30_000,
  });
}

/**
 * Create-customer mutation. POSTs to /crm-api/customers (Idempotency-Key minted
 * by apiClient, org from the JWT). Invalidates the customer list tree so any
 * open list or picker refetches with the new row. Used by the inline
 * quick-create modal on the reference pickers.
 */
export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation<Customer, Error, CustomerCreate>({
    mutationFn: (body) => createCustomer(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customersKeys.all });
    },
  });
}

/**
 * Invite-to-portal mutation. POSTs to /crm-api/customers/:id/invite-to-portal,
 * which calls supabase.auth.admin.inviteUserByEmail + create_portal_membership
 * RPC server-side. On success, returns { membership_id, user_id, email,
 * customer_id }. Invalidates the customer detail query so any portal-related
 * status fields render fresh.
 */
export function useInviteCustomerToPortal(customerId: string) {
  const qc = useQueryClient();
  return useMutation<InviteToPortalResult, Error, { email_override?: string }>({
    mutationFn: (body) => inviteCustomerToPortal(customerId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customersKeys.detail(customerId) });
    },
  });
}
