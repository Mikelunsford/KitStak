// TanStack Query hooks for the 3PL Billing Review (Wave 12 Phase A7). Mirrors
// useJobRuns: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the review's audit timeline. The FSM
// transitions (approve / cancel), the PATCH update, and the soft delete each
// invalidate billingReviewsKeys.all plus the review's audit timeline. Job
// Profitability is a read-only view, so its hook is query-only.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { billingReviewsKeys, jobProfitabilityKeys } from '@/lib/queryKeys/threepl';
import {
  listBillingReviews,
  getBillingReview,
  createBillingReview,
  updateBillingReview,
  softDeleteBillingReview,
  approveBillingReview,
  cancelBillingReview,
  type BillingReview,
  type BillingReviewCreate,
  type BillingReviewPatch,
  type ListBillingReviewsFilters,
} from '@/lib/services/billingReviewsService';
import {
  listJobProfitability,
  type ListJobProfitabilityFilters,
} from '@/lib/services/jobProfitabilityService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// billing_review entity_type for the audit timeline (the A7 audit trigger
// writes rows under this type).
const BILLING_REVIEW_ENTITY = 'billing_review';

// ---------------------------------------------------------------------------
// billing_reviews
// ---------------------------------------------------------------------------

export function useBillingReviewsList(filters: ListBillingReviewsFilters = {}) {
  return useQuery({
    queryKey: billingReviewsKeys.list(filters),
    queryFn: () => listBillingReviews(filters),
    ...C,
  });
}

export function useBillingReview(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? billingReviewsKeys.detail(id)
      : ['threepl', 'billing_reviews', 'detail', 'noop'],
    queryFn: () => getBillingReview(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateBillingReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillingReviewCreate) => createBillingReview(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingReviewsKeys.all });
    },
  });
}

export function useUpdateBillingReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillingReviewPatch) => updateBillingReview(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingReviewsKeys.all });
      void qc.invalidateQueries({
        queryKey: auditLogKeys.byEntity(BILLING_REVIEW_ENTITY, id),
      });
    },
  });
}

export function useSoftDeleteBillingReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteBillingReview(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingReviewsKeys.all });
      void qc.invalidateQueries({
        queryKey: auditLogKeys.byEntity(BILLING_REVIEW_ENTITY, id),
      });
    },
  });
}

function useTransitionBillingReview(
  id: string,
  fn: (id: string) => Promise<BillingReview>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingReviewsKeys.all });
      void qc.invalidateQueries({
        queryKey: auditLogKeys.byEntity(BILLING_REVIEW_ENTITY, id),
      });
    },
  });
}

export function useApproveBillingReview(id: string) {
  return useTransitionBillingReview(id, approveBillingReview);
}

export function useCancelBillingReview(id: string) {
  return useTransitionBillingReview(id, cancelBillingReview);
}

// ---------------------------------------------------------------------------
// view_job_profitability (read-only)
// ---------------------------------------------------------------------------

export function useJobProfitability(filters: ListJobProfitabilityFilters = {}) {
  return useQuery({
    queryKey: jobProfitabilityKeys.list(filters),
    queryFn: () => listJobProfitability(filters),
    ...C,
  });
}

export type { BillingReview };
