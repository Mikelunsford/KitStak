// MembersListPage. KitForce pillar. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable +
// StatusBadge + Pagination replace the hand-rolled header, status select,
// table, and raw status pill. Behavior preserved: the ?status= deep-link from
// the home tiles still seeds the filter, the create CTA stays gated on
// kitforce.member.create, the onboarding ListEmptyState only shows when
// unfiltered, and the default-rate column is still gated on
// kitforce.member.read_rate (the column is omitted entirely for roles without
// it; DataTable derives the empty-row colSpan from columns.length).

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { useMembersList } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import type {
  WorkforceMember,
  WorkforceMemberStatus,
} from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

type StatusFilter = WorkforceMemberStatus | 'all';

const ALLOWED_MEMBER_STATUSES = new Set<string>(['active', 'inactive']);
const MEMBER_STATUSES: WorkforceMemberStatus[] = ['active', 'inactive'];

function parseMemberStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_MEMBER_STATUSES.has(raw)) {
    return raw as WorkforceMemberStatus;
  }
  return 'all';
}

function renderMemberDetails(m: WorkforceMember) {
  return <ReferenceField label="Number" value={m.member_number} />;
}

export function MembersListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseMemberStatusParam(searchParams.get('status')),
  );
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { status?: StatusFilter } = {};
    if (status !== 'all') f.status = status;
    return f;
  }, [status]);

  const members = useMembersList(filters);
  const caps = useVioCapabilities();
  const canReadRate = caps.can('kitforce.member.read_rate');

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }

  // C2 rate gate: the default-rate column is omitted entirely for roles
  // without kitforce.member.read_rate, so the columns array is computed from
  // canReadRate. DataTable reads columns.length for the empty-row colSpan, so
  // the column count stays correct without a manual colSpan.
  const columns = useMemo<ReadonlyArray<DataColumn<WorkforceMember>>>(() => {
    const cols: DataColumn<WorkforceMember>[] = [
      {
        key: 'member',
        header: 'Member',
        render: (m) => (
          <Link to={`/kitforce/members/${m.id}`} className={LINK_CLASS}>
            {m.display_name ?? m.member_number}
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (m) => <StatusBadge status={m.status} />,
      },
      {
        key: 'email',
        header: 'Email',
        cellClassName: 'text-ink-dim',
        render: (m) => m.email ?? '·',
      },
      {
        key: 'phone',
        header: 'Phone',
        cellClassName: 'text-ink-dim',
        render: (m) => m.phone ?? '·',
      },
    ];
    if (canReadRate) {
      cols.push({
        key: 'rate',
        header: 'Default rate',
        align: 'right',
        cellClassName: 'tabular-nums text-ink-dim',
        render: (m) =>
          m.default_hourly_rate_cents != null
            ? `${formatCents(m.default_hourly_rate_cents, 'USD')}/hr`
            : '·',
      });
    }
    return cols;
  }, [canReadRate]);

  const rows = members.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !members.isLoading && !members.error
      ? `${totalCount} ${totalCount === 1 ? 'member' : 'members'}`
      : undefined;

  const chips: FilterChip[] =
    status !== 'all'
      ? [
          {
            key: 'status',
            label: `Status: ${humaniseStatus(status)}`,
            onClear: () => applyStatus('all'),
          },
        ]
      : [];

  const showOnboardingEmpty =
    !members.isLoading && !members.error && totalCount === 0 && status === 'all';

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="KitForce / Members"
        title="Members"
        meta={meta}
        actions={
          caps.can('kitforce.member.create') ? (
            <Link to="/kitforce/members/new">
              <Button variant="primary">New member</Button>
            </Link>
          ) : undefined
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={status}
            onChange={(e) => applyStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {members.error ? (
        <p className="font-sans text-accent">Failed to load members.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="member"
          explainer="Members are the people who perform labor for your org. Add a worker to start scheduling and tracking time."
          addLabel="Add member"
          addTo="/kitforce/members/new"
          canAdd={caps.can('kitforce.member.create')}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(m) => m.id}
            loading={members.isLoading}
            empty="No members match the current filters."
            renderRowDetails={renderMemberDetails}
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
