import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { projectsKeys } from '@/lib/queryKeys/projects';
import {
  listProjects, getProject, createProject, transitionProject,
  createPhase, transitionPhase, reorderPhases,
  type ListProjectsFilters,
} from '@/lib/services/projectsService';
import type {
  CreateProjectRequest, TransitionRequest, ReorderPhasesRequest,
  ProjectLineItem, CreateProjectLineItemRequest,
} from '@/lib/types/sales';

// === Project queries / mutations ===========================================

export function useProjectsList(filters: ListProjectsFilters = {}) {
  return useQuery({
    queryKey: projectsKeys.list({
      state: filters.state ?? null,
      customer_id: filters.customer_id ?? null,
    }),
    queryFn: () => listProjects(filters),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: id ? projectsKeys.byId(id) : ['sales', 'projects', 'byId', '__none__'],
    queryFn: () => getProject(id as string),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => createProject(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}

export function useTransitionProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransitionRequest) => transitionProject(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(id) });
      void qc.invalidateQueries({ queryKey: projectsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: state transitions write an audit_log
      // row via trg_audit_projects_state; invalidate the timeline cache so
      // an operator returning to the detail page sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('project', id) });
    },
  });
}

export function useCreatePhase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string | null; position?: number }) =>
      createPhase(projectId, payload),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: phase create writes an audit_log row
      // for the new project_phase row; invalidate the phase timeline if the
      // backend returns its id so detail navigations show the entry.
      const phaseId = (created as { id?: string } | undefined)?.id;
      if (phaseId) {
        void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('project_phase', phaseId) });
      }
    },
  });
}

export function useTransitionPhase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { phaseId: string; body: TransitionRequest }) =>
      transitionPhase(projectId, args.phaseId, args.body),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: phase state transitions write an
      // audit_log row via trg_audit_phases_state; invalidate the timeline
      // for this specific phase so the operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('project_phase', args.phaseId) });
    },
  });
}

export function useReorderPhases(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderPhasesRequest) => reorderPhases(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
    },
  });
}

// === Project line items =====================================================
// Wraps the projects-api endpoints landed in migrations 0044 and 0045 under
// the /projects-api/projects/:id/<sub> Pattern-B convention.

const projectLineItemsKey = (projectId: string) =>
  ['sales', 'projects', 'byId', projectId, 'line-items'] as const;

export function useProjectLineItems(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? projectLineItemsKey(projectId)
      : ['sales', 'projects', 'byId', '__none__', 'line-items'],
    queryFn: async () =>
      apiRequest<ProjectLineItem[]>(
        `/projects-api/projects/${projectId}/line-items`,
        { method: 'GET' },
      ),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useAddProjectLineItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectLineItemRequest) =>
      apiRequest<ProjectLineItem>(
        `/projects-api/projects/${projectId}/line-items`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectLineItemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
    },
  });
}

export function useRemoveProjectLineItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) =>
      apiRequest<{ id: string; deleted: boolean }>(
        `/projects-api/projects/${projectId}/line-items/${lineId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectLineItemsKey(projectId) });
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
    },
  });
}

// === Project completion -> invoice (G-COMPLETE-AUTO-01) ====================
// The convert_project_to_invoice RPC returns the new invoice id under the
// `invoice_id` key (shaped by projects-api handler at line 465).

export interface ConvertProjectToInvoiceResult {
  invoice_id: string;
}

export function useConvertProjectToInvoice(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<ConvertProjectToInvoiceResult>(
        `/projects-api/projects/${projectId}/convert-to-invoice`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
      void qc.invalidateQueries({ queryKey: ['invoicing', 'invoices'] });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: convert RPC drives a project state
      // transition that writes an audit row; invalidate the project's
      // timeline so the operator returning sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('project', projectId) });
    },
  });
}
