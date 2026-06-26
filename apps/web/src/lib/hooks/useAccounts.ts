// TanStack Query hooks for the 3PL Accounts commercial layer (Wave 12 Phase
// A1). Mirrors useOps: shared cache config, list/detail reads, and mutations
// that invalidate the entity key plus the account's audit timeline so the
// detail HISTORY rail reflects the latest state transitions.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { accountsKeys, accountServicesKeys } from '@/lib/queryKeys/threepl';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deactivateAccount,
  reactivateAccount,
  listAccountServices,
  createAccountService,
  updateAccountService,
  deleteAccountService,
  type ThreePlAccount,
  type ThreePlAccountCreate,
  type ThreePlAccountPatch,
  type ListAccountsFilters,
  type AccountServiceDefinitionCreate,
  type AccountServiceDefinitionUpdate,
} from '@/lib/services/accountsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// three_pl_accounts entity_type for the audit timeline (migration 0089
// audit_append_state_change trigger writes rows under this type).
const ACCOUNT_ENTITY = 'three_pl_account';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function useAccountsList(filters: ListAccountsFilters = {}) {
  return useQuery({
    queryKey: accountsKeys.list(filters),
    queryFn: () => listAccounts(filters),
    ...C,
  });
}

export function useAccount(id: string | undefined) {
  return useQuery({
    queryKey: id ? accountsKeys.detail(id) : ['threepl', 'accounts', 'detail', 'noop'],
    queryFn: () => getAccount(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ThreePlAccountCreate) => createAccount(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKeys.all });
    },
  });
}

export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ThreePlAccountPatch) => updateAccount(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKeys.all });
      // The account UPDATE writes an audit_log row via the 0089 trigger;
      // refresh the detail timeline so the operator sees the latest entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(ACCOUNT_ENTITY, id) });
    },
  });
}

export function useDeactivateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateAccount(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(ACCOUNT_ENTITY, id) });
    },
  });
}

export function useReactivateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reactivateAccount(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(ACCOUNT_ENTITY, id) });
    },
  });
}

// ---------------------------------------------------------------------------
// account_service_definitions (per-account Rate Card overlay)
// ---------------------------------------------------------------------------

export function useAccountServices(accountId: string | undefined) {
  return useQuery({
    queryKey: accountId
      ? accountServicesKeys.byAccount(accountId)
      : ['threepl', 'accounts', 'detail', '__none__', 'services'],
    queryFn: () => listAccountServices(accountId as string),
    enabled: !!accountId,
    ...C,
  });
}

export function useCreateAccountService(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountServiceDefinitionCreate) =>
      createAccountService(accountId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountServicesKeys.byAccount(accountId) });
    },
  });
}

export function useUpdateAccountService(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { serviceId: string; body: AccountServiceDefinitionUpdate }) =>
      updateAccountService(accountId, args.serviceId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountServicesKeys.byAccount(accountId) });
    },
  });
}

export function useDeleteAccountService(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => deleteAccountService(accountId, serviceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountServicesKeys.byAccount(accountId) });
    },
  });
}

export type { ThreePlAccount };
