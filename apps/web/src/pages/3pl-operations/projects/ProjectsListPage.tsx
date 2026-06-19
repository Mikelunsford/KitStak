// ProjectsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on name and number, sortable headers, state facet, keyset
// pager, saved views) behind feature.list_toolbar. The flag-off path is the
// original client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader +
// DataTable + StatusBadge + Pagination), extracted verbatim into
// ProjectsListLegacy; the flag-on path is ProjectsListToolbar. The parent
// renders one or the other.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useProjectsList } from '@/lib/hooks/useProjects';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listProjectsPage } from '@/lib/services/projectsService';
import { projectsKeys } from '@/lib/queryKeys/projects';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Project } from '@/lib/types/sales';

const PAGE_SIZE = 50;

// Project states the toolbar accepts via ?state=. Mirrors the 6-state FSM
// (migration 0016); an arbitrary string never reaches the facet state.
const PROJECT_STATES = [
  'pending',
  'ready_to_build',
  'in_production',
  'ready_to_ship',
  'completed',
  'cancelled',
] as const;

const COLUMNS: ReadonlyArray<DataColumn<Project>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'name',
    render: (p) => (
      <Link to={`/projects/${p.id}`} className={LINK_CLASS}>
        {p.name ?? p.number}
      </Link>
    ),
  },
  {
    key: 'state',
    header: 'State',
    sortKey: 'state',
    render: (p) => <StatusBadge status={p.state} />,
  },
  {
    key: 'due',
    header: 'Due',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (p) => p.due_date ?? '.',
  },
];

function renderProjectDetails(p: Project) {
  return <ReferenceField label="Number" value={p.number} />;
}

export function ProjectsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ProjectsListToolbar />
  ) : (
    <ProjectsListLegacy />
  );
}

function ProjectsListToolbar() {
  const server = useServerList<Project>({
    enabled: true,
    queryKeyBase: projectsKeys.all,
    fetchPage: listProjectsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'state', label: 'State', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Projects"
        title="Projects"
        actions={
          <Link to="/projects/new">
            <Button variant="primary">New project</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or number"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            State
          </span>
          <Select
            value={server.facetValues.state ?? ''}
            onChange={(e) => server.setFacet('state', e.target.value)}
            aria-label="Filter by state"
          >
            <option value="">All states</option>
            {PROJECT_STATES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="project"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load projects.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(p) => p.id}
            loading={server.isLoading}
            empty="No projects match these filters."
            renderRowDetails={renderProjectDetails}
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

function ProjectsListLegacy() {
  const { data, isLoading, error } = useProjectsList();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'project' : 'projects'}`
      : undefined;

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Projects"
        title="Projects"
        meta={meta}
        actions={
          <Link to="/projects/new">
            <Button variant="primary">New project</Button>
          </Link>
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load projects.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="project"
          explainer="Projects are accepted quotes you are delivering."
          addLabel="Add project"
          addTo="/projects/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(p) => p.id}
            loading={isLoading}
            empty="No projects yet."
            renderRowDetails={renderProjectDetails}
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
