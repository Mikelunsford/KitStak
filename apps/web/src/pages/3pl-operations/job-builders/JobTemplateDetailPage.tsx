// JobTemplateDetailPage (Wave 12 Phase A2). The Job Builder hub: key fields,
// the builder lines (component / service / step) section, and a HISTORY rail
// (the audit timeline). HUB-style detail pages SET the eyebrow (FSM detail
// pages omit it); a job template is a hub, not a registered FSM, so the eyebrow
// is set and there is no StateStepper. Status moves via the deactivate /
// reactivate actions, gated on threepl.job_template.deactivate.

import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useJobTemplate,
  useDeactivateJobTemplate,
  useReactivateJobTemplate,
} from '@/lib/hooks/useJobTemplates';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { jobTypesKeys } from '@/lib/queryKeys/jobTypes';
import { listJobTypes } from '@/lib/services/jobTypesService';

import { JobTemplateLines } from './JobTemplateLines';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

// Resolve a spine job_type_id to its name. Display-only; reuses the cached
// job-types list the create form already loads.
function JobTypeName({ id }: { id: string | null }) {
  const { data } = useQuery({
    queryKey: jobTypesKeys.list(),
    queryFn: () => listJobTypes(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: !!id,
  });
  if (!id) return <span className="text-ink">{''}</span>;
  const row = data?.find((j) => j.id === id);
  return <span className="text-ink">{row ? row.name : id}</span>;
}

export function JobTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const templateId = id ?? '';
  const template = useJobTemplate(id);
  const deactivate = useDeactivateJobTemplate(templateId);
  const reactivate = useReactivateJobTemplate(templateId);
  const caps = useCapabilities();

  if (template.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (template.error || !template.data) {
    return <p className="px-8 py-12 text-accent">Job builder not found.</p>;
  }
  const d = template.data;
  const canToggleStatus = caps.can('threepl.job_template.deactivate');
  const togglePending = deactivate.isPending || reactivate.isPending;
  const toggleError = deactivate.error || reactivate.error;

  const onDeactivate = async () => {
    const ok = await destructiveConfirm({
      action: 'Deactivate this job builder',
      consequence:
        'The job builder moves to inactive and drops out of the active list. You can reactivate it later.',
    });
    if (!ok) return;
    deactivate.mutate();
  };

  const statusAction = canToggleStatus ? (
    d.status === 'active' ? (
      <Button variant="secondary" onClick={onDeactivate} disabled={togglePending}>
        {deactivate.isPending ? 'Deactivating.' : 'Deactivate'}
      </Button>
    ) : (
      <Button
        variant="secondary"
        onClick={() => reactivate.mutate()}
        disabled={togglePending}
      >
        {reactivate.isPending ? 'Reactivating.' : 'Reactivate'}
      </Button>
    )
  ) : null;

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Job Builders', to: '/3pl-operations/job-builders' },
          { label: d.name },
        ]}
      />
      <PageHeader eyebrow="3PL Operations" title={d.name} actions={statusAction} />

      {toggleError && (
        <p className="font-sans text-sm text-accent">
          {toggleError instanceof Error ? toggleError.message : 'Status change failed.'}
        </p>
      )}

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="job_template" entityId={id ?? null} />
          </section>
        }
      >
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Template number</dt>
          <dd className="text-ink tabular-nums">{d.template_number ?? ''}</dd>
          <dt className="text-ink-dim">Variant</dt>
          <dd className="text-ink capitalize">{d.variant}</dd>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink">
            <StatusBadge status={d.status} />
          </dd>
          <dt className="text-ink-dim">Job type</dt>
          <dd className="text-ink">
            <JobTypeName id={d.job_type_id} />
          </dd>
          <dt className="text-ink-dim">Default BOM item</dt>
          <dd className="text-ink">
            <EntityLabel kind="item" id={d.default_bom_item_id} />
          </dd>
          <dt className="text-ink-dim">Created</dt>
          <dd className="text-ink">{formatDate(d.created_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink">{d.notes ?? ''}</dd>
        </dl>

        <JobTemplateLines templateId={templateId} />
      </DetailLayout>
    </section>
  );
}
