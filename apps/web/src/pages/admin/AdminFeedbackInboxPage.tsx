// AdminFeedbackInboxPage. The platform-staff cross-tenant support inbox
// (feedback-admin-api). Gated by useIsPlatformStaff(): while the probe loads we
// render nothing meaningful, and if the caller is not staff we show a plain
// "Not authorized" message. The server, via is_platform_staff() plus the
// service role, is the real authority on the data calls; this is render-gating.
//
// The table is cross-org, so it carries org_name and the submitter email an
// operator needs to triage without leaving the surface. Status and type filters
// ride the FilterBar.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import {
  useIsPlatformStaff,
  useStaffTickets,
} from '@/lib/hooks/useFeedback';
import {
  SupportTicketStatusSchema,
  SupportTicketTypeSchema,
  type SupportTicketStaff,
  type SupportTicketStatus,
  type SupportTicketType,
} from '@/lib/types/feedback';

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<SupportTicketType, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  question: 'Question',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

const COLUMNS: ReadonlyArray<DataColumn<SupportTicketStaff>> = [
  {
    key: 'org_name',
    header: 'Org',
    cellClassName: 'text-ink-dim',
    render: (t) => t.org_name ?? '.',
  },
  {
    key: 'title',
    header: 'Title',
    render: (t) => (
      <Link to={`/admin/feedback/${t.id}`} className={LINK_CLASS}>
        {t.title}
      </Link>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    cellClassName: 'text-ink-dim',
    render: (t) => TYPE_LABEL[t.type],
  },
  {
    key: 'status',
    header: 'Status',
    render: (t) => <StatusBadge status={t.status} />,
  },
  {
    key: 'priority',
    header: 'Priority',
    cellClassName: 'text-ink-dim',
    render: (t) => (t.priority ? t.priority : '.'),
  },
  {
    key: 'created_by_email',
    header: 'Submitted by',
    cellClassName: 'text-ink-dim',
    render: (t) => t.created_by_email ?? '.',
  },
  {
    key: 'created_at',
    header: 'Submitted',
    cellClassName: 'text-ink-dim tabular-nums',
    render: (t) => formatDate(t.created_at),
  },
];

export function AdminFeedbackInboxPage() {
  const staff = useIsPlatformStaff();
  const [status, setStatus] = useState<SupportTicketStatus | ''>('');
  const [type, setType] = useState<SupportTicketType | ''>('');
  const [page, setPage] = useState(0);

  const filters = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };
  const tickets = useStaffTickets(filters);

  if (staff.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Checking access.</p>;
  }
  if (!staff.data) {
    return (
      <section className="mx-auto max-w-3xl px-8 py-12">
        <PageHeader title="Feedback inbox" />
        <p className="mt-4 font-sans text-sm text-ink-dim">Not authorized.</p>
      </section>
    );
  }

  const rows = tickets.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    totalCount > 0
      ? `${totalCount} ticket${totalCount === 1 ? '' : 's'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader title="Feedback inbox" meta={meta} />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SupportTicketStatus | '');
            setPage(0);
          }}
          aria-label="Filter tickets by status"
        >
          <option value="">All statuses</option>
          {SupportTicketStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value as SupportTicketType | '');
            setPage(0);
          }}
          aria-label="Filter tickets by type"
        >
          <option value="">All types</option>
          {SupportTicketTypeSchema.options.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(t) => t.id}
        loading={tickets.isLoading}
        empty="No tickets match this filter."
      />

      {totalCount > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
