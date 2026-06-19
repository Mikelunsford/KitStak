// TeamsListPage. KitForce pillar. The flag-on path (feature.list_toolbar) is the
// server list toolbar (search on name, sortable NOT NULL columns, keyset pager,
// saved views) via TeamsListToolbar. The flag-off path is the original
// client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader + DataTable +
// StatusBadge + Pagination), extracted verbatim into TeamsListLegacy. Teams are
// a flat library (no state machine), so create stays an inline form on both
// paths rather than a dedicated page; that form and its kitforce.team.write gate
// are preserved.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useTeamsList, useCreateTeam } from '@/lib/hooks/useKitForce';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listTeamsPage } from '@/lib/services/kitforceService';
import { teamsKeys } from '@/lib/queryKeys/kitforce';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { WorkforceTeam, WorkforceTeamCreate } from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

// Shared column set. sortKey is set only on the NOT NULL sortable column (name);
// active is a boolean render and notes is nullable, so neither carries a sort.
const COLUMNS: ReadonlyArray<DataColumn<WorkforceTeam>> = [
  {
    key: 'name',
    header: 'Team',
    sortKey: 'name',
    render: (t) => (
      <Link to={`/kitforce/teams/${t.id}`} className={LINK_CLASS}>
        {t.name}
      </Link>
    ),
  },
  {
    key: 'active',
    header: 'Active',
    render: (t) => (
      <StatusBadge status={t.is_active ? 'active' : 'inactive'} />
    ),
  },
  {
    key: 'notes',
    header: 'Notes',
    cellClassName: 'text-ink-dim',
    render: (t) => t.notes ?? '·',
  },
];

// Inline create form shared by both paths. Teams have no dedicated create page.
function TeamCreateForm() {
  const create = useCreateTeam();
  const caps = useVioCapabilities();
  const canWrite = caps.can('kitforce.team.write');

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !name.trim()) return;
    const body: WorkforceTeamCreate = { name: name.trim() };
    if (notes.trim()) body.notes = notes.trim();
    create.mutate(body, {
      onSuccess: () => {
        setName('');
        setNotes('');
      },
    });
  }

  if (!canWrite) {
    return create.error ? (
      <p className="text-accent font-sans text-sm">
        {create.error instanceof Error ? create.error.message : 'Create failed.'}
      </p>
    ) : null;
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-4 items-end border border-line bg-bg-2 p-4"
      >
        <div className="flex-1 min-w-[12rem]">
          <TextInput
            label="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <TextInput
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? 'Saving.' : 'Add team'}
        </Button>
      </form>
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}
    </>
  );
}

export function TeamsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <TeamsListToolbar />
  ) : (
    <TeamsListLegacy />
  );
}

function TeamsListToolbar() {
  const server = useServerList<WorkforceTeam>({
    enabled: true,
    queryKeyBase: teamsKeys.all,
    fetchPage: listTeamsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [],
  });

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="KitForce / Teams" title="Teams" />

      <TeamCreateForm />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search team name"
        chips={server.chips}
        onClearAll={server.clearAll}
      />

      <SavedViewsBar
        entityType="team"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="text-accent font-sans text-sm">Failed to load teams.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(t) => t.id}
            loading={server.isLoading}
            empty="No teams match these filters."
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

function TeamsListLegacy() {
  const teams = useTeamsList();
  const [page, setPage] = useState(0);

  const rows = teams.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !teams.isLoading && !teams.error
      ? `${totalCount} ${totalCount === 1 ? 'team' : 'teams'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="KitForce / Teams" title="Teams" meta={meta} />

      <TeamCreateForm />

      {teams.error ? (
        <p className="text-accent font-sans text-sm">
          {teams.error instanceof Error
            ? teams.error.message
            : 'Failed to load teams.'}
        </p>
      ) : !teams.isLoading && totalCount === 0 ? (
        <ListEmptyState
          entity="team"
          explainer="Teams group members into crews, lines, and pick teams so you can schedule and assign work in bulk."
          addLabel="Add team"
          addTo="/kitforce/teams"
          canAdd={false}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(t) => t.id}
            loading={teams.isLoading}
            empty="No teams yet."
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
