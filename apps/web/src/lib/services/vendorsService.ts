// Vendors service. Wraps `vendors-api/vendors` endpoints.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  VendorSchema, type Vendor,
} from '@/lib/types/vendors_inventory_ops';

export type { Vendor };

export interface VendorsListPage {
  items: Vendor[];
  next_cursor: string | null;
}

const VendorListSchema = VendorSchema.array();

export async function listVendors(params: { cursor?: string | null; limit?: number } = {}): Promise<VendorsListPage> {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  const raw = await apiRequest<unknown>(
    `/vendors-api/vendors${qs ? `?${qs}` : ''}`, { method: 'GET' },
  );
  // Envelope here returns array as data and next_cursor in meta. apiClient
  // strips the envelope, so we re-shape on the caller side via a wrapper.
  return { items: (raw as Vendor[]).map((v) => VendorSchema.parse(v)), next_cursor: null };
}

// Workstream C: server-driven list toolbar page (search, sort, keyset). The
// vendor list returns its rows in `data` and next_cursor in `meta`, so this
// reads the full envelope via apiRequestWithMeta.
export async function listVendorsPage(
  params: ServerListParams,
): Promise<{ items: Vendor[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `/vendors-api/vendors${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: VendorListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function getVendor(id: string): Promise<Vendor> {
  const data = await apiRequest<unknown>(`/vendors-api/vendors/${id}`, { method: 'GET' });
  return VendorSchema.parse(data);
}

export async function createVendor(input: Partial<Vendor>): Promise<Vendor> {
  const data = await apiRequest<unknown>('/vendors-api/vendors', { method: 'POST', body: input });
  return VendorSchema.parse(data);
}

export async function updateVendor(id: string, input: Partial<Vendor>): Promise<Vendor> {
  const data = await apiRequest<unknown>(`/vendors-api/vendors/${id}`, { method: 'PATCH', body: input });
  return VendorSchema.parse(data);
}

export async function deleteVendor(id: string): Promise<void> {
  await apiRequest<unknown>(`/vendors-api/vendors/${id}`, { method: 'DELETE' });
}
