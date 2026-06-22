// JobTemplatesListPage (Wave 12 Phase A2). The Job Builder list surface: the
// reusable templates that drive 3PL jobs. Workstream C of the 2026-06-17 UI scan
// adds the server list toolbar (search on name and template number, sortable
// headers, status and variant facets, keyset pager, saved views) behind
// feature.list_toolbar. The flag-off path is the original client-state view
// (PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination),
// extracted verbatim into JobTemplatesListLegacy; the flag-on path is
// JobTemplatesListToolbar. The parent renders one or the other. The create CTA
// is gated on threepl.job_template.create in both paths; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useJobTemplatesList } from '@/lib/hooks/useJobTemplates';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listJobTemplatesPage } from '@/lib/services/jobTemplatesService';
import { jobTemplatesKeys } from '@/lib/queryKeys/threepl';
import { FEATURE_FLAGS } from '@/lib/constants';
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
    sortKey: 'name',
    render: (t) => (
      <Link to={`/3pl-operations/job-builders/${t.id}`} className={LINK_CLASS}>
        {t.name ?? t.template_number}
      </Link>
    ),
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
    sortKey: 'status',
    render: (t) => <StatusBadge status={t.status} />,
  },
];

function renderJobTemplateDetails(t: JobTemplate) {
  return <ReferenceField label="Number" value={t.template_number} />;
}

export function JobTemplatesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <JobTemplatesListToolbar />
  ) : (
    <JobTemplatesListLegacy />
  );
}

function JobTemplatesListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<JobTemplate>({
    enabled: true,
    queryKeyBase: jobTemplatesKeys.all,
    fetchPage: listJobTemplatesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'status', label: 'Status', format: humaniseStatus },
      { key: 'variant', label: 'Variant' },
    ],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Job Builders"
        actions={
          caps.can('threepl.job_template.create') ? (
            <Link to="/3pl-operations/job-builders/new">
              <Button variant="primary">New job builder</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or template number"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter job builders by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Variant
          </span>
          <Select
            value={server.facetValues.variant ?? ''}
            onChange={(e) => server.setFacet('variant', e.target.value)}
            aria-label="Filter job builders by variant"
          >
            <option value="">All variants</option>
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="job_builder"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load job builders.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(t) => t.id}
            loading={server.isLoading}
            empty="No job builders match these filters."
            renderRowDetails={renderJobTemplateDetails}
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
          />
          <CursorPager
            canPrev={server.canPrev}
            canNext={server.canNext}
            onPrev={server.onPrev}
            onNext={server.onNext}
            label={`${server.rows.length} shown`}
          />
        </>
      )}
    </section>
  );
}

function JobTemplatesListLegacy() {
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
            renderRowDetails={renderJobTemplateDetails}
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
