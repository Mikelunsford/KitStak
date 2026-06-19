// 3PL Billing Review service (Wave 12 Phase A7). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl), sibling to jobRunsService.
//
// A billing_review is the finance reconciliation surface over a completed Job
// Run: the planned estimate_total_cents against the realized actual_total_cents
// before an invoice is cut. Its FSM (draft -> approved -> invoiced; cancel off
// draft / approved) moves via server RPCs (approve / cancel), not table writes.
// Approve creates the spine draft invoice, lands the review approved, and fills
// invoice_id. The apiClient attaches the Idempotency-Key for non-GET requests,
// so handlers never hand-roll it.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import {
  BillingReviewSchema,
  type BillingReview,
  type BillingReviewStatus,
  type BillingReviewCreate,
  type BillingReviewPatch,
} from '@/lib/types/threepl';

export type {
  BillingReview,
  BillingReviewStatus,
  BillingReviewCreate,
  BillingReviewPatch,
};

const BASE = '/three-pl-api/billing-reviews';

export type ListBillingReviewsFilters = {
  status?: BillingReviewStatus;
  job_run_id?: string;
  project_id?: string;
  account_id?: string;
};

function billingReviewsQs(f: ListBillingReviewsFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.job_run_id) p.set('job_run_id', f.job_run_id);
  if (f.project_id) p.set('project_id', f.project_id);
  if (f.account_id) p.set('account_id', f.account_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Workstream C (UI scan): the list route now returns a keyset page envelope
// { items, next_cursor } (Shape A / DATA-cursor) on every request, mirroring
// inventory warehouses / copack. The legacy flat-list reader extracts items.
const BillingReviewListEnvelope = z.object({
  items: z.array(BillingReviewSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listBillingReviews(
  filters: ListBillingReviewsFilters = {},
): Promise<BillingReview[]> {
  const raw = await apiRequest<unknown>(`${BASE}${billingReviewsQs(filters)}`, {
    method: 'GET',
  });
  return BillingReviewListEnvelope.parse(raw).items;
}

export async function listBillingReviewsPage(
  params: ServerListParams,
): Promise<{ items: BillingReview[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  const parsed = BillingReviewListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
}

export async function getBillingReview(id: string): Promise<BillingReview> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return BillingReviewSchema.parse(data);
}

export async function createBillingReview(
  input: BillingReviewCreate,
): Promise<BillingReview> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return BillingReviewSchema.parse(data);
}

export async function updateBillingReview(
  id: string,
  input: BillingReviewPatch,
): Promise<BillingReview> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return BillingReviewSchema.parse(data);
}

export async function softDeleteBillingReview(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// FSM transitions. Each is a server RPC; the response is the updated review.
// approve creates the spine draft invoice, lands approved, and sets invoice_id.
export async function approveBillingReview(id: string): Promise<BillingReview> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/approve`, {
    method: 'POST',
  });
  return BillingReviewSchema.parse(data);
}

export async function cancelBillingReview(id: string): Promise<BillingReview> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/cancel`, {
    method: 'POST',
  });
  return BillingReviewSchema.parse(data);
}
