// TanStack Query hooks for the 3PL Job Builder commercial layer (Wave 12 Phase
// A2). Mirrors useAccounts: shared cache config, list/detail reads, and
// mutations that invalidate the entity key plus the template's audit timeline
// so the detail HISTORY rail reflects the latest state transitions.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { jobTemplatesKeys, jobTemplateLinesKeys } from '@/lib/queryKeys/threepl';
import {
  listJobTemplates,
  getJobTemplate,
  createJobTemplate,
  updateJobTemplate,
  deactivateJobTemplate,
  reactivateJobTemplate,
  softDeleteJobTemplate,
  listJobTemplateLines,
  createJobTemplateLine,
  updateJobTemplateLine,
  deleteJobTemplateLine,
  type JobTemplate,
  type JobTemplateCreate,
  type JobTemplatePatch,
  type ListJobTemplatesFilters,
  type JobTemplateLineCreate,
  type JobTemplateLineUpdate,
} from '@/lib/services/jobTemplatesService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// job_templates entity_type for the audit timeline (migration 0091
// audit trigger writes rows under this type).
const JOB_TEMPLATE_ENTITY = 'job_template';

// ---------------------------------------------------------------------------
// Job templates
// ---------------------------------------------------------------------------

export function useJobTemplatesList(filters: ListJobTemplatesFilters = {}) {
  return useQuery({
    queryKey: jobTemplatesKeys.list(filters),
    queryFn: () => listJobTemplates(filters),
    ...C,
  });
}

export function useJobTemplate(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? jobTemplatesKeys.detail(id)
      : ['threepl', 'job_templates', 'detail', 'noop'],
    queryFn: () => getJobTemplate(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateJobTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobTemplateCreate) => createJobTemplate(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplatesKeys.all });
    },
  });
}

export function useUpdateJobTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobTemplatePatch) => updateJobTemplate(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplatesKeys.all });
      // The template UPDATE writes an audit_log row via the 0091 trigger;
      // refresh the detail timeline so the operator sees the latest entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_TEMPLATE_ENTITY, id) });
    },
  });
}

export function useDeactivateJobTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateJobTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplatesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_TEMPLATE_ENTITY, id) });
    },
  });
}

export function useReactivateJobTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reactivateJobTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplatesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_TEMPLATE_ENTITY, id) });
    },
  });
}

export function useSoftDeleteJobTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteJobTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplatesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_TEMPLATE_ENTITY, id) });
    },
  });
}

// ---------------------------------------------------------------------------
// job_template_lines (builder definition lines)
// ---------------------------------------------------------------------------

export function useJobTemplateLines(templateId: string | undefined) {
  return useQuery({
    queryKey: templateId
      ? jobTemplateLinesKeys.byTemplate(templateId)
      : ['threepl', 'job_templates', 'detail', '__none__', 'lines'],
    queryFn: () => listJobTemplateLines(templateId as string),
    enabled: !!templateId,
    ...C,
  });
}

export function useCreateJobTemplateLine(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobTemplateLineCreate) =>
      createJobTemplateLine(templateId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplateLinesKeys.byTemplate(templateId) });
    },
  });
}

export function useUpdateJobTemplateLine(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: JobTemplateLineUpdate }) =>
      updateJobTemplateLine(templateId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplateLinesKeys.byTemplate(templateId) });
    },
  });
}

export function useDeleteJobTemplateLine(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteJobTemplateLine(templateId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobTemplateLinesKeys.byTemplate(templateId) });
    },
  });
}

export type { JobTemplate };
