import { apiRequest } from '@/lib/apiClient';
import {
  QuoteSchema, QuoteLineItemSchema,
  type Quote, type QuoteLineItem,
  type CreateQuoteRequest, type CreateQuoteLineRequest,
  type ConvertQuoteToProjectRequest,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(QuoteSchema),
  next_cursor: z.string().nullable().optional(),
});

const DetailEnvelope = z.object({
  quote: QuoteSchema,
  line_items: z.array(QuoteLineItemSchema),
});

export async function listQuotes(state?: string): Promise<Quote[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  const raw = await apiRequest<unknown>(`/quotes-api/quotes${qs}`, { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getQuote(id: string): Promise<{ quote: Quote; lineItems: QuoteLineItem[] }> {
  const raw = await apiRequest<unknown>(`/quotes-api/quotes/${id}`, { method: 'GET' });
  const parsed = DetailEnvelope.parse(raw);
  return { quote: parsed.quote, lineItems: parsed.line_items };
}

export async function createQuote(payload: CreateQuoteRequest): Promise<Quote> {
  const raw = await apiRequest<unknown>('/quotes-api/quotes', {
    method: 'POST', body: payload,
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

export async function removeLineItem(
  quoteId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest(`/quotes-api/quotes/${quoteId}/line-items/${lineId}`, { method: 'DELETE' });
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
