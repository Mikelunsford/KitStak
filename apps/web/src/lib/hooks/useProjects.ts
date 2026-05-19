import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import { projectsKeys } from '@/lib/queryKeys/projects';
import {
  listProjects, getProject, createProject, transitionProject,
  createPhase, transitionPhase, reorderPhases,
} from '@/lib/services/projectsService';
import type {
  CreateProjectRequest, TransitionRequest, ReorderPhasesRequest,
  ProjectLineItem, CreateProjectLineItemRequest,
} from '@/lib/types/sales';

// === Project queries / mutations ===========================================

export function useProjectsList(state?: string) {
  return useQuery({
    queryKey: projectsKeys.list({ state: state ?? null }),
    queryFn: () => listProjects(state),
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
    },
  });
}

export function useCreatePhase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string | null; position?: number }) =>
      createPhase(projectId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
    },
  });
}

export function useTransitionPhase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { phaseId: string; body: TransitionRequest }) =>
      transitionPhase(projectId, args.phaseId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectsKeys.byId(projectId) });
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

// === Project line items (Phase 6.5 carryover from quotes) ==================
// TODO 6.5-A: these wrap the projects-api endpoints Agent 6.5-B ships in
// migration slot 0044 / 0045. The endpoint paths follow the existing
// /projects-api/projects/:id/<sub> Pattern-B convention. If 6.5-B chooses
// different paths, the orchestrator's Canon Steward pass realigns these
// strings.

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
    },
  });
}
