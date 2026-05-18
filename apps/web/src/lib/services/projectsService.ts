import { apiRequest } from '@/lib/apiClient';
import {
  ProjectSchema, ProjectPhaseSchema,
  type Project, type ProjectPhase,
  type CreateProjectRequest, type TransitionRequest,
  type ReorderPhasesRequest,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(ProjectSchema),
  next_cursor: z.string().nullable().optional(),
});

const DetailEnvelope = z.object({
  project: ProjectSchema,
  phases: z.array(ProjectPhaseSchema),
});

export async function listProjects(state?: string): Promise<Project[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  const raw = await apiRequest<unknown>(`/projects-api/projects${qs}`, { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getProject(
  id: string,
): Promise<{ project: Project; phases: ProjectPhase[] }> {
  const raw = await apiRequest<unknown>(`/projects-api/projects/${id}`, { method: 'GET' });
  return DetailEnvelope.parse(raw);
}

export async function createProject(payload: CreateProjectRequest): Promise<Project> {
  const raw = await apiRequest<unknown>('/projects-api/projects', {
    method: 'POST', body: payload,
  });
  return ProjectSchema.parse(raw);
}

export async function transitionProject(
  id: string, body: TransitionRequest,
): Promise<Project> {
  const raw = await apiRequest<unknown>(`/projects-api/projects/${id}/transition`, {
    method: 'POST', body,
  });
  return ProjectSchema.parse(raw);
}

export async function createPhase(
  projectId: string,
  payload: { name: string; description?: string | null; position?: number },
): Promise<ProjectPhase> {
  const raw = await apiRequest<unknown>(`/projects-api/projects/${projectId}/phases`, {
    method: 'POST', body: payload,
  });
  return ProjectPhaseSchema.parse(raw);
}

export async function transitionPhase(
  projectId: string, phaseId: string, body: TransitionRequest,
): Promise<ProjectPhase> {
  const raw = await apiRequest<unknown>(
    `/projects-api/projects/${projectId}/phases/${phaseId}/transition`,
    { method: 'POST', body },
  );
  return ProjectPhaseSchema.parse(raw);
}

export async function reorderPhases(
  projectId: string, body: ReorderPhasesRequest,
): Promise<{ project_id: string; ordered: string[] }> {
  return apiRequest(`/projects-api/projects/${projectId}/phases/reorder`, {
    method: 'PATCH', body,
  });
}
