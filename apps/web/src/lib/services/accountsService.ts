// 3PL Accounts service (Wave 12 Phase A1). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl). Sibling to the ops-api services
// (receiving / shipments); this bundle owns the 3PL commercial layer.
//
// Accounts are the service-relationship layer over a CRM customer (customer_id
// required, never copied). account_service_definitions are the per-account
// Rate Card overlay. Money is BIGINT _cents on the wire. The apiClient attaches
// the Idempotency-Key for non-GET requests, so handlers never hand-roll it.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import {
  ThreePlAccountSchema,
  AccountServiceDefinitionSchema,
  type ThreePlAccount,
  type ThreePlAccountStatus,
  type ThreePlAccountCreate,
  type ThreePlAccountPatch,
  type AccountServiceDefinition,
  type AccountServiceKind,
  type AccountServiceDefinitionCreate,
  type AccountServiceDefinitionUpdate,
} from '@/lib/types/threepl';

export type {
  ThreePlAccount,
  ThreePlAccountStatus,
  ThreePlAccountCreate,
  ThreePlAccountPatch,
  AccountServiceDefinition,
  AccountServiceKind,
  AccountServiceDefinitionCreate,
  AccountServiceDefinitionUpdate,
};

const BASE = '/three-pl-api/accounts';

// ---------------------------------------------------------------------------
// three_pl_accounts
// ---------------------------------------------------------------------------

export type ListAccountsFilters = {
  status?: ThreePlAccountStatus;
  customer_id?: string;
};

function accountsQs(f: ListAccountsFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.customer_id) p.set('customer_id', f.customer_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Workstream C (UI scan): the list route now returns a keyset page envelope
// { items, next_cursor } (Shape A / DATA-cursor) on every request, mirroring
// inventory warehouses / copack. The legacy flat-list reader extracts items.
const AccountListEnvelope = z.object({
  items: z.array(ThreePlAccountSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listAccounts(
  filters: ListAccountsFilters = {},
): Promise<ThreePlAccount[]> {
  const raw = await apiRequest<unknown>(`${BASE}${accountsQs(filters)}`, {
    method: 'GET',
  });
  return AccountListEnvelope.parse(raw).items;
}

export async function listAccountsPage(
  params: ServerListParams,
): Promise<{ items: ThreePlAccount[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  const parsed = AccountListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
}

export async function getAccount(id: string): Promise<ThreePlAccount> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return ThreePlAccountSchema.parse(data);
}

export async function createAccount(
  input: ThreePlAccountCreate,
): Promise<ThreePlAccount> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return ThreePlAccountSchema.parse(data);
}

export async function updateAccount(
  id: string,
  input: ThreePlAccountPatch,
): Promise<ThreePlAccount> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return ThreePlAccountSchema.parse(data);
}

export async function deactivateAccount(id: string): Promise<ThreePlAccount> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/deactivate`, {
    method: 'POST',
  });
  return ThreePlAccountSchema.parse(data);
}

export async function reactivateAccount(id: string): Promise<ThreePlAccount> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/reactivate`, {
    method: 'POST',
  });
  return ThreePlAccountSchema.parse(data);
}

export async function softDeleteAccount(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// account_service_definitions (per-account Rate Card overlay)
// ---------------------------------------------------------------------------

export async function listAccountServices(
  accountId: string,
): Promise<AccountServiceDefinition[]> {
  const data = await apiRequest<unknown>(`${BASE}/${accountId}/services`, {
    method: 'GET',
  });
  return (data as AccountServiceDefinition[]).map((r) =>
    AccountServiceDefinitionSchema.parse(r),
  );
}

export async function createAccountService(
  accountId: string,
  input: AccountServiceDefinitionCreate,
): Promise<AccountServiceDefinition> {
  const data = await apiRequest<unknown>(`${BASE}/${accountId}/services`, {
    method: 'POST',
    body: input,
  });
  return AccountServiceDefinitionSchema.parse(data);
}

export async function updateAccountService(
  accountId: string,
  serviceId: string,
  input: AccountServiceDefinitionUpdate,
): Promise<AccountServiceDefinition> {
  const data = await apiRequest<unknown>(
    `${BASE}/${accountId}/services/${serviceId}`,
    { method: 'PATCH', body: input },
  );
  return AccountServiceDefinitionSchema.parse(data);
}

export async function deleteAccountService(
  accountId: string,
  serviceId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${accountId}/services/${serviceId}`,
    { method: 'DELETE' },
  );
}
