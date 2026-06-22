// Hooks for cross-cutting surfaces. Thin TanStack Query wrappers per the
// service layer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listAttachments,
  createAttachment,
  deleteAttachment,
} from '@/lib/services/attachmentsService';
import {
  listComments,
  createComment,
  deleteComment,
} from '@/lib/services/commentsService';
import {
  listNotifications,
  markNotificationRead,
} from '@/lib/services/notificationsService';
import {
  listSavedViews,
  createSavedView,
  deleteSavedView,
} from '@/lib/services/savedViewsService';
import { globalSearch } from '@/lib/services/searchService';
import {
  getDashboardSummary,
  getSellSummary,
  getMoneySummary,
  getInventorySummary,
  getProductionSummary,
} from '@/lib/services/dashboardService';
import {
  getPortalMe,
  listPortalInvoices,
  listPortalQuotes,
  listPortalProjects,
} from '@/lib/services/portalService';
import { listPdfTemplates } from '@/lib/services/pdfService';
import {
  attachmentsKeys,
  commentsKeys,
  notificationsKeys,
  savedViewsKeys,
  searchKeys,
  dashboardKeys,
  portalKeys,
  pdfKeys,
} from '@/lib/queryKeys/crossCutting';

export function useAttachments(entityType: string, entityId: string | null) {
  return useQuery({
    queryKey: attachmentsKeys.list(entityType, entityId ?? ''),
    queryFn: () => listAttachments(entityType, entityId as string),
    enabled: entityId !== null,
    staleTime: 30_000,
  });
}

export function useCreateAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAttachment,
    onSuccess: (att) => {
      qc.invalidateQueries({
        queryKey: attachmentsKeys.list(att.entity_type, att.entity_id),
      });
    },
  });
}

export function useDeleteAttachment(entityType: string, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentsKeys.list(entityType, entityId) });
    },
  });
}

export function useComments(entityType: string, entityId: string | null) {
  return useQuery({
    queryKey: commentsKeys.list(entityType, entityId ?? ''),
    queryFn: () => listComments(entityType, entityId as string),
    enabled: entityId !== null,
    staleTime: 30_000,
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createComment,
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: commentsKeys.list(c.entity_type, c.entity_id) });
    },
  });
}

export function useDeleteComment(entityType: string, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKeys.list(entityType, entityId) });
    },
  });
}

export function useNotifications(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notificationsKeys.list(),
    queryFn: listNotifications,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKeys.list() }),
  });
}

export function useSavedViews(entityType: string) {
  return useQuery({
    queryKey: savedViewsKeys.list(entityType),
    queryFn: () => listSavedViews(entityType),
    staleTime: 60_000,
  });
}

export function useCreateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSavedView,
    onSuccess: (v) => qc.invalidateQueries({ queryKey: savedViewsKeys.list(v.entity_type) }),
  });
}

export function useDeleteSavedView(entityType: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => qc.invalidateQueries({ queryKey: savedViewsKeys.list(entityType) }),
  });
}

export function useGlobalSearch(query: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: searchKeys.query(query),
    queryFn: () => globalSearch(query),
    enabled: (opts.enabled ?? true) && query.trim().length > 0,
    staleTime: 15_000,
  });
}

export function useDashboardSummary(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: getDashboardSummary,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useSellSummary(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.sellSummary(),
    queryFn: getSellSummary,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useMoneySummary(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.moneySummary(),
    queryFn: getMoneySummary,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useInventorySummary(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.inventorySummary(),
    queryFn: getInventorySummary,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useProductionSummary(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dashboardKeys.productionSummary(),
    queryFn: getProductionSummary,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function usePortalMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: portalKeys.me(),
    queryFn: getPortalMe,
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

export function usePortalInvoices(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: portalKeys.invoices(),
    queryFn: listPortalInvoices,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function usePortalQuotes(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: portalKeys.quotes(),
    queryFn: listPortalQuotes,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function usePortalProjects(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: portalKeys.projects(),
    queryFn: listPortalProjects,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

export function usePdfTemplates() {
  return useQuery({
    queryKey: pdfKeys.templates(),
    queryFn: listPdfTemplates,
    staleTime: 5 * 60_000,
  });
}
