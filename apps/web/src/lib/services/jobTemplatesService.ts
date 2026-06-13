// 3PL Job Builder service (Wave 12 Phase A2). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl), sibling to accountsService; this
// bundle owns the 3PL commercial layer.
//
// job_templates are the Job Builder engine: a branded variant preset plus an
// active/inactive flag, optionally tied to a spine job type and a default BOM
// item (the parent item whose bom_items compose the BOM; there is no standalone
// boms table). job_template_lines are the builder definition: component,
// service, and step lines. Money is BIGINT _cents on the wire; quantity is
// numeric. The apiClient attaches the Idempotency-Key for non-GET requests, so
// handlers never hand-roll it.

import { apiRequest } from '@/lib/apiClient';
import {
  JobTemplateSchema,
  JobTemplateLineSchema,
  type JobTemplate,
  type JobTemplateStatus,
  type JobTemplateVariant,
  type JobTemplateCreate,
  type JobTemplatePatch,
  type JobTemplateLine,
  type JobTemplateLineKind,
  type JobTemplateLineCreate,
  type JobTemplateLineUpdate,
} from '@/lib/types/threepl';

export type {
  JobTemplate,
  JobTemplateStatus,
  JobTemplateVariant,
  JobTemplateCreate,
  JobTemplatePatch,
  JobTemplateLine,
  JobTemplateLineKind,
  JobTemplateLineCreate,
  JobTemplateLineUpdate,
};

const BASE = '/three-pl-api/job-templates';

// ---------------------------------------------------------------------------
// job_templates
// ---------------------------------------------------------------------------

export type ListJobTemplatesFilters = {
  status?: JobTemplateStatus;
  variant?: JobTemplateVariant;
};

function jobTemplatesQs(f: ListJobTemplatesFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.variant) p.set('variant', f.variant);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listJobTemplates(
  filters: ListJobTemplatesFilters = {},
): Promise<JobTemplate[]> {
  const data = await apiRequest<unknown>(`${BASE}${jobTemplatesQs(filters)}`, {
    method: 'GET',
  });
  return (data as JobTemplate[]).map((r) => JobTemplateSchema.parse(r));
}

export async function getJobTemplate(id: string): Promise<JobTemplate> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return JobTemplateSchema.parse(data);
}

export async function createJobTemplate(
  input: JobTemplateCreate,
): Promise<JobTemplate> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return JobTemplateSchema.parse(data);
}

export async function updateJobTemplate(
  id: string,
  input: JobTemplatePatch,
): Promise<JobTemplate> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return JobTemplateSchema.parse(data);
}

export async function deactivateJobTemplate(id: string): Promise<JobTemplate> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/deactivate`, {
    method: 'POST',
  });
  return JobTemplateSchema.parse(data);
}

export async function reactivateJobTemplate(id: string): Promise<JobTemplate> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/reactivate`, {
    method: 'POST',
  });
  return JobTemplateSchema.parse(data);
}

export async function softDeleteJobTemplate(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// job_template_lines (builder definition: component / service / step lines)
// ---------------------------------------------------------------------------

export async function listJobTemplateLines(
  templateId: string,
): Promise<JobTemplateLine[]> {
  const data = await apiRequest<unknown>(`${BASE}/${templateId}/lines`, {
    method: 'GET',
  });
  return (data as JobTemplateLine[]).map((r) => JobTemplateLineSchema.parse(r));
}

export async function createJobTemplateLine(
  templateId: string,
  input: JobTemplateLineCreate,
): Promise<JobTemplateLine> {
  const data = await apiRequest<unknown>(`${BASE}/${templateId}/lines`, {
    method: 'POST',
    body: input,
  });
  return JobTemplateLineSchema.parse(data);
}

export async function updateJobTemplateLine(
  templateId: string,
  lineId: string,
  input: JobTemplateLineUpdate,
): Promise<JobTemplateLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${templateId}/lines/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return JobTemplateLineSchema.parse(data);
}

export async function deleteJobTemplateLine(
  templateId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${templateId}/lines/${lineId}`,
    { method: 'DELETE' },
  );
}
