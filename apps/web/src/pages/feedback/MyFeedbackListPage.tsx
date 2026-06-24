// MyFeedbackListPage. A tester's own support tickets (feedback-api). Title links
// to the detail thread; type, status, and created date round out the row, with
// the reference number tucked into the per-row Additional details disclosure.
// The header carries a "Send feedback" button that opens the same modal as the
// topbar affordance.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { useMyTickets } from '@/lib/hooks/useFeedback';
import { SendFeedbackModal } from './SendFeedbackModal';
import {
  SupportTicketStatusSchema,
  SupportTicketTypeSchema,
  type SupportTicket,
  type SupportTicketStatus,
  type SupportTicketType,
} from '@/lib/types/feedback';

const PAGE_SIZE = 20;

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

const COLUMNS: ReadonlyArray<DataColumn<SupportTicket>> = [
  {
    key: 'title',
    header: 'Title',
    render: (t) => (
      <Link to={`/feedback/tickets/${t.id}`} className={LINK_CLASS}>
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
    key: 'created_at',
    header: 'Submitted',
    cellClassName: 'text-ink-dim tabular-nums',
    render: (t) => formatDate(t.created_at),
  },
];

function renderTicketDetails(t: SupportTicket) {
  if (!t.reference) return null;
  return (
    <span className="font-sans text-sm text-ink-dim">
      Reference <span className="tabular-nums text-ink">{t.reference}</span>
    </span>
  );
}

export function MyFeedbackListPage() {
  const [status, setStatus] = useState<SupportTicketStatus | ''>('');
  const [type, setType] = useState<SupportTicketType | ''>('');
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const filters = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };
  const tickets = useMyTickets(filters);

  const rows = tickets.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    totalCount > 0
      ? `${totalCount} ticket${totalCount === 1 ? '' : 's'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Feedback"
        meta={meta}
        actions={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            Send feedback
          </Button>
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SupportTicketStatus | '');
            setPage(0);
          }}
          aria-label="Filter feedback by status"
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
          aria-label="Filter feedback by type"
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
        empty="You have not sent any feedback yet."
        renderRowDetails={renderTicketDetails}
      />

      {totalCount > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}

      <SendFeedbackModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </section>
  );
}
