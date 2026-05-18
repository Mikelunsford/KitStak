import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { projectsKeys } from '@/lib/queryKeys/projects';
import {
  listProjects, getProject, createProject, transitionProject,
  createPhase, transitionPhase, reorderPhases,
} from '@/lib/services/projectsService';
import type {
  CreateProjectRequest, TransitionRequest, ReorderPhasesRequest,
} from '@/lib/types/sales';

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
