// ProjectsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader + DataTable + StatusBadge + Pagination replace the
// hand-rolled header, the raw state text, and the hand-rolled table. The
// project state values are already in the shared StatusBadge maps.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useProjectsList } from '@/lib/hooks/useProjects';
import type { Project } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Project>> = [
  {
    key: 'name',
    header: 'Name',
    render: (p) => (
      <Link to={`/projects/${p.id}`} className={LINK_CLASS}>
        {p.name ?? p.number}
      </Link>
    ),
  },
  {
    key: 'state',
    header: 'State',
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
