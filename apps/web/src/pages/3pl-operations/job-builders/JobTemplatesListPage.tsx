// JobTemplatesListPage (Wave 12 Phase A2). The Job Builder list surface: the
// reusable templates that drive 3PL jobs. Shared UI kit (PageHeader + FilterBar
// + DataTable + Pagination + StatusBadge) matching the Accounts / Receiving
// list surfaces. The status and variant filters narrow the list server-side
// (three-pl-api GET /job-templates?status=&variant=). The create CTA is gated
// on threepl.job_template.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useJobTemplatesList } from '@/lib/hooks/useJobTemplates';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  JobTemplate,
  JobTemplateStatus,
  JobTemplateVariant,
} from '@/lib/services/jobTemplatesService';

const PAGE_SIZE = 50;

const VARIANTS: ReadonlyArray<JobTemplateVariant> = [
  'kit',
  'sidekick',
  'repack',
  'labeling',
  'inspection',
  'custom',
];

const COLUMNS: ReadonlyArray<DataColumn<JobTemplate>> = [
  {
    key: 'name',
    header: 'Name',
    render: (t) => (
      <Link
        to={`/3pl-operations/job-builders/${t.id}`}
        className="text-ink hover:text-accent"
      >
        {t.name}
      </Link>
    ),
  },
  {
    key: 'number',
    header: 'Template #',
    cellClassName: 'font-mono',
    render: (t) => t.template_number ?? t.id.slice(0, 8),
  },
  {
    key: 'variant',
    header: 'Variant',
    cellClassName: 'capitalize text-ink-dim',
    render: (t) => t.variant,
  },
  {
    key: 'status',
    header: 'Status',
    render: (t) => <StatusBadge status={t.status} />,
  },
];

export function JobTemplatesListPage() {
  const [status, setStatus] = useState<JobTemplateStatus | ''>('');
  const [variant, setVariant] = useState<JobTemplateVariant | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useJobTemplatesList({
    ...(status ? { status } : {}),
    ...(variant ? { variant } : {}),
  });
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  // Onboarding empty (the guided "add your first" CTA) only when the org has no
  // templates at all. When a filter matches nothing, the DataTable inline empty
  // state shows inside the frame instead.
  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !status && !variant;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'job builder' : 'job builders'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="3PL Operations"
        title="Job Builders"
        meta={meta}
        actions={
          caps.can('threepl.job_template.create') ? (
            <Link to="/3pl-operations/job-builders/new">
              <Button variant="primary">New job builder</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as JobTemplateStatus | '');
            setPage(0);
          }}
          aria-label="Filter job builders by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select
          value={variant}
          onChange={(e) => {
            setVariant(e.target.value as JobTemplateVariant | '');
            setPage(0);
          }}
          aria-label="Filter job builders by variant"
        >
          <option value="">All variants</option>
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load job builders.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="job builder"
          explainer="Job builders are the reusable templates that drive 3PL jobs: the components, services, and steps a kit, repack, or labeling run is built from."
          addLabel="Add job builder"
          addTo="/3pl-operations/job-builders/new"
          canAdd={caps.can('threepl.job_template.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(t) => t.id}
            loading={isLoading}
            empty="No job builders match this filter."
          />
          {totalCount > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
