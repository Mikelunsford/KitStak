// TeamsListPage. KitForce pillar. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, table, and Yes/No active text. Teams are a
// flat library (no state machine), so create stays an inline form rather than a
// dedicated page; that form, its kitforce.team.write gate, and the
// ListEmptyState (canAdd false, since creation is inline) are preserved.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useTeamsList, useCreateTeam } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkforceTeam, WorkforceTeamCreate } from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<WorkforceTeam>> = [
  {
    key: 'name',
    header: 'Team',
    render: (t) => (
      <Link to={`/kitforce/teams/${t.id}`} className="text-ink hover:text-accent">
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

export function TeamsListPage() {
  const teams = useTeamsList();
  const create = useCreateTeam();
  const caps = useVioCapabilities();
  const canWrite = caps.can('kitforce.team.write');
  const [page, setPage] = useState(0);

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
      <PageHeader eyebrow="Workforce / Teams" title="Teams" meta={meta} />

      {canWrite ? (
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
      ) : null}
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}

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
