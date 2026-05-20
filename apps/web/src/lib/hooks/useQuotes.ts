import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { bucketCents, track } from '@/lib/analytics';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { quotesKeys } from '@/lib/queryKeys/quotes';
import {
  listQuotes, getQuote, createQuote, submitQuote, approveQuote,
  reviseQuote, cancelQuote, sendQuote, convertQuoteToProject,
  addLineItem, removeLineItem,
  type ListQuotesFilters,
} from '@/lib/services/quotesService';
import type { CreateQuoteRequest, CreateQuoteLineRequest } from '@/lib/types/sales';

export function useQuotesList(filters: ListQuotesFilters = {}) {
  return useQuery({
    queryKey: quotesKeys.list({
      state: filters.state ?? null,
      customer_id: filters.customer_id ?? null,
    }),
    queryFn: () => listQuotes(filters),
  });
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: id ? quotesKeys.byId(id) : ['sales', 'quotes', 'byId', '__none__'],
    queryFn: () => getQuote(id as string),
    enabled: !!id,
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateQuoteRequest) => createQuote(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotesKeys.all });
    },
  });
}

function useQuoteAction(action: (id: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => action(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: quotesKeys.byId(id) });
      void qc.invalidateQueries({ queryKey: quotesKeys.all });
      // F-Wave6-AUDIT-02: state-change mutations also write an audit_log row
      // via the BEFORE UPDATE trg_audit_quotes_state trigger; the timeline
      // query cache must be invalidated or the operator sees the pre-mutation
      // snapshot (TanStack staleTime 30s, refetchOnWindowFocus false).
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('quote', id) });
    },
  });
}

export const useSubmitQuote   = () => useQuoteAction(submitQuote);
export const useApproveQuote  = () => useQuoteAction(approveQuote);
export const useReviseQuote   = () => useQuoteAction(reviseQuote);
export const useCancelQuote   = () => useQuoteAction(cancelQuote);

/**
 * Send-quote mutation. Wires the F-Wave5-CO-02 `quote_sent` funnel
 * event on success. Total amount is bucketed via bucketCents so absolute
 * dollar values never leak into the analytics event log.
 */
export function useSendQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendQuote(id),
    onSuccess: (quote, id) => {
      void qc.invalidateQueries({ queryKey: quotesKeys.byId(id) });
      void qc.invalidateQueries({ queryKey: quotesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('quote', id) });
      track('quote_sent', {
        quote_id: quote.id,
        customer_id: quote.customer_id ?? null,
        total_cents_bucket: bucketCents(quote.total_cents),
      });
    },
  });
}

export function useConvertQuoteToProject() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (id: string) => convertQuoteToProject(id),
    onSuccess: (result, id) => {
      void qc.invalidateQueries({ queryKey: quotesKeys.all });
      void qc.invalidateQueries({ queryKey: ['sales', 'projects'] });
      // F-Wave6-AUDIT-02: convert RPC drives a quote.state approved ->
      // project_pending transition that writes an audit row; invalidate
      // the source quote's timeline so the operator returning to the page
      // sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('quote', id) });
      // F-Wave5-CO-02: emit the project_converted funnel event. The
      // source quote id plus the new project id are both opaque UUIDs
      // (no PII). No amount is tracked here; the dollar value belongs
      // to the upstream quote_sent event.
      if (result?.project_id) {
        track('project_converted', {
          source_quote_id: id,
          project_id: result.project_id,
        });
      }
      // G-CONVERT-02: navigate to the newly created project so the operator
      // can immediately continue the chain instead of staying on the source
      // quote with no breadcrumb forward.
      if (result?.project_id) {
        navigate(`/3pl-operations/projects/${result.project_id}`);
      }
    },
  });
}

export function useAddLineItem(quoteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateQuoteLineRequest) => addLineItem(quoteId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotesKeys.byId(quoteId) });
    },
  });
}

export function useRemoveLineItem(quoteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => removeLineItem(quoteId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotesKeys.byId(quoteId) });
    },
  });
}
