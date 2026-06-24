import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import {
  QuoteSchema, QuoteLineItemSchema, QuoteTierSchema,
  type Quote, type QuoteLineItem, type QuoteTier,
  type CreateQuoteRequest, type UpdateQuoteRequest, type CreateQuoteLineRequest,
  type UpdateQuoteLineRequest,
  type ConvertQuoteToProjectRequest,
  type CreateQuoteTierRequest, type UpdateQuoteTierRequest,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(QuoteSchema),
  next_cursor: z.string().nullable().optional(),
});

const DetailEnvelope = z.object({
  quote: QuoteSchema,
  line_items: z.array(QuoteLineItemSchema),
  // ADR 0004: the quote's tiers ride alongside its lines. Optional + defaulted
  // for backward compatibility with any cached pre-tier response shape.
  tiers: z.array(QuoteTierSchema).optional().default([]),
});

export type ListQuotesFilters = {
  state?: string;
  customer_id?: string;
};

function quotesQs(filters: ListQuotesFilters): string {
  const p = new URLSearchParams();
  if (filters.state) p.set('state', filters.state);
  if (filters.customer_id) p.set('customer_id', filters.customer_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listQuotes(filters: ListQuotesFilters = {}): Promise<Quote[]> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes${quotesQs(filters)}`, { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

// Workstream C: the server-driven list toolbar page (search, sort, keyset).
// next_cursor rides in the data envelope for quotes, so apiRequest suffices.
export async function listQuotesPage(
  params: ServerListParams,
): Promise<{ items: Quote[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes${serverListQs(params)}`, { method: 'GET' });
  const parsed = ListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
}

export async function getQuote(
  id: string,
): Promise<{ quote: Quote; lineItems: QuoteLineItem[]; tiers: QuoteTier[] }> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${id}`, { method: 'GET' });
  const parsed = DetailEnvelope.parse(raw);
  return { quote: parsed.quote, lineItems: parsed.line_items, tiers: parsed.tiers };
}

export async function createQuote(payload: CreateQuoteRequest): Promise<Quote> {
  const raw = await apiRequest<unknown>('/quotes-api/quotes', {
    method: 'POST', body: payload,
  });
  return QuoteSchema.parse(raw);
}

export async function updateQuote(
  id: string,
  payload: UpdateQuoteRequest,
): Promise<Quote> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${id}`, {
    method: 'PATCH', body: payload,
  });
  return QuoteSchema.parse(raw);
}

export async function addLineItem(
  quoteId: string,
  payload: CreateQuoteLineRequest,
): Promise<QuoteLineItem> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${quoteId}/line-items`, {
    method: 'POST', body: payload,
  });
  return QuoteLineItemSchema.parse(raw);
}

export async function updateLineItem(
  quoteId: string,
  lineId: string,
  payload: UpdateQuoteLineRequest,
): Promise<QuoteLineItem> {
  const raw = await apiRequest<unknown>(
    `/quotes-api/quotes/${quoteId}/line-items/${lineId}`,
    { method: 'PATCH', body: payload },
  );
  return QuoteLineItemSchema.parse(raw);
}

export async function removeLineItem(
  quoteId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest(`/quotes-api/quotes/${quoteId}/line-items/${lineId}`, { method: 'DELETE' });
}

// ADR 0004 tier CRUD. The per-tier totals are server-derived by
// recompute_quote_totals, so these calls carry only the operator-editable fields.
export async function createTier(
  quoteId: string, payload: CreateQuoteTierRequest,
): Promise<QuoteTier> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${quoteId}/tiers`, {
    method: 'POST', body: payload,
  });
  return QuoteTierSchema.parse(raw);
}

export async function updateTier(
  quoteId: string, tierId: string, payload: UpdateQuoteTierRequest,
): Promise<QuoteTier> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${quoteId}/tiers/${tierId}`, {
    method: 'PATCH', body: payload,
  });
  return QuoteTierSchema.parse(raw);
}

export async function deleteTier(
  quoteId: string, tierId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest(`/quotes-api/quotes/${quoteId}/tiers/${tierId}`, { method: 'DELETE' });
}

export async function reorderTiers(
  quoteId: string, tierIds: string[],
): Promise<QuoteTier[]> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${quoteId}/tiers/reorder`, {
    method: 'POST', body: { tier_ids: tierIds },
  });
  return z.array(QuoteTierSchema).parse(raw);
}

async function quoteAction(quoteId: string, action: string): Promise<Quote> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${quoteId}/${action}`, {
    method: 'POST', body: {},
  });
  return QuoteSchema.parse(raw);
}

export const submitQuote   = (id: string) => quoteAction(id, 'submit');
export const approveQuote  = (id: string) => quoteAction(id, 'approve');
export const reviseQuote   = (id: string) => quoteAction(id, 'revise');
export const cancelQuote   = (id: string) => quoteAction(id, 'cancel');
export const sendQuote     = (id: string) => quoteAction(id, 'send');

export async function convertQuoteToProject(
  id: string,
  payload: ConvertQuoteToProjectRequest = {},
): Promise<{ project_id: string }> {
  return apiRequest(`/quotes-api/quotes/${id}/convert-to-project`, {
    method: 'POST', body: payload,
  });
}

// P1-3: clone a quote (header plus lines) into a new draft. The server runs the
// duplicate_quote RPC in one atomic write and returns the new quote id.
export async function duplicateQuote(id: string): Promise<{ id: string }> {
  return apiRequest(`/quotes-api/quotes/${id}/duplicate`, {
    method: 'POST', body: {},
  });
}
