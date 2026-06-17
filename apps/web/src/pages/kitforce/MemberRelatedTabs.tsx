// MemberRelatedTabs. F-UIUX-HUB-TABS-MEMBER-01 panel components for the KitForce
// member hub. Extracted into a sibling file so each panel render function stays
// small and the MemberDetailPage shell reads as a thin tab assembler.
//
// The Overview panel carries the member's own metadata (with the
// kitforce.member.read_rate gate on the default hourly rate preserved) plus the
// HISTORY audit timeline. The three related panels (assignments, time entries,
// shifts) are read-only: KitForce creates those entities via inline forms on
// their list pages, not via dedicated create routes that accept a member_id
// prefill, so none use RelatedSection. Each renders a titled section with a
// loading line, a coaching empty state with no CTA, or a list of rows. Rows link
// to a detail route where one exists (assignments, shifts); time entries have no
// detail route (only an edit page) so they render as static text.

import { ClipboardList, Clock, CalendarClock, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatCents } from '@/lib/money';
import { formatDateMedium, formatDateTimeMedium } from '@/lib/dates';
import type {
  WorkforceMember,
  WorkAssignment,
  TimeEntry,
  Shift,
} from '@/lib/types/kitforce';

/** Minutes ride the wire as numeric(18,4); round to one decimal for display. */
function formatMinutes(min: number | string | null): string {
  if (min === null || min === '') return '·';
  const n = typeof min === 'string' ? Number(min) : min;
  if (Number.isNaN(n)) return '·';
  return (Math.round(n * 10) / 10).toString();
}

// ---------------------------------------------------------------------------
// Overview: the member's own data plus its HISTORY timeline.
// ---------------------------------------------------------------------------

export interface MemberOverviewPanelProps {
  member: WorkforceMember;
  memberId: string | null;
  canReadRate: boolean;
}

export function MemberOverviewPanel({
  member,
  memberId,
  canReadRate,
}: MemberOverviewPanelProps) {
  const d = member;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Member number</dt>
        <dd className="text-ink font-mono">{d.member_number ?? 'None'}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd className="text-ink">{d.email ?? '·'}</dd>
        <dt className="text-ink-dim">Phone</dt>
        <dd className="text-ink">{d.phone ?? '·'}</dd>
        {canReadRate ? (
          <>
            <dt className="text-ink-dim">Default hourly rate</dt>
            <dd className="text-ink font-mono">
              {d.default_hourly_rate_cents != null
                ? `${formatCents(d.default_hourly_rate_cents, 'USD')}/hr`
                : 'None'}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-dim">Notes</dt>
        <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
        <dt className="text-ink-dim">Created</dt>
        <dd className="text-ink">{formatDateMedium(d.created_at)}</dd>
      </dl>

      <section>
        <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
          HISTORY
        </h2>
        <AuditTimeline entityType="workforce_member" entityId={memberId} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared read-only related-list shell. No CTA: these entities are created via
// inline forms on their list pages, not via member-prefilled create routes.
// ---------------------------------------------------------------------------

interface RelatedReadOnlyProps {
  title: string;
  entity: string;
  explainer: string;
  icon: LucideIcon;
  isLoading: boolean;
  count: number;
  children: ReactNode;
}

function RelatedReadOnly({
  title,
  entity,
  explainer,
  icon,
  isLoading,
  count,
  children,
}: RelatedReadOnlyProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-display tracking-wide text-ink">{title}</h2>
      {isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading.</p>
      ) : count > 0 ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <DetailSectionEmptyCoaching
          entity={entity}
          explainer={explainer}
          icon={icon}
        />
      )}
    </section>
  );
}

const ROW_CLASS = 'border border-line bg-bg-2 px-3 py-2 text-sm font-sans';

// ---------------------------------------------------------------------------
// Assignments: title links to the assignment detail route, plus a status badge.
// ---------------------------------------------------------------------------

export function MemberAssignmentsPanel({
  rows,
  isLoading,
}: {
  rows: ReadonlyArray<WorkAssignment>;
  isLoading: boolean;
}) {
  return (
    <RelatedReadOnly
      title="ASSIGNMENTS"
      entity="assignment"
      explainer="Assignments are units of work routed to this member. Queue one from the assignments list."
      icon={ClipboardList}
      isLoading={isLoading}
      count={rows.length}
    >
      {rows.map((a) => (
        <li key={a.id} className={ROW_CLASS}>
          <Link to={`/kitforce/assignments/${a.id}`} className="underline">
            {a.title}
          </Link>
          <span className="ml-2 inline-flex">
            <StatusBadge status={a.status} />
          </span>
        </li>
      ))}
    </RelatedReadOnly>
  );
}

// ---------------------------------------------------------------------------
// Time entries: no detail route (edit only), so rows are static text. Rate is
// gated on kitforce.member.read_rate, matching the Overview rate field.
// ---------------------------------------------------------------------------

export function MemberTimeEntriesPanel({
  rows,
  isLoading,
  canReadRate,
}: {
  rows: ReadonlyArray<TimeEntry>;
  isLoading: boolean;
  canReadRate: boolean;
}) {
  return (
    <RelatedReadOnly
      title="TIME ENTRIES"
      entity="time entry"
      explainer="Time entries clock this member in and out so labor hours roll up into cost. Clock in from the time entries list."
      icon={Clock}
      isLoading={isLoading}
      count={rows.length}
    >
      {rows.map((t) => (
        <li key={t.id} className={ROW_CLASS}>
          <span className="text-ink">{formatDateTimeMedium(t.clock_in_at)}</span>
          <span className="ml-2 text-ink-dim text-xs font-mono">
            {formatMinutes(t.minutes)} min
            {t.clock_out_at == null ? ' . open' : ''}
          </span>
          {canReadRate ? (
            <span className="ml-2 text-ink-dim text-xs font-mono">
              {formatCents(t.hourly_rate_cents, 'USD')}/hr
            </span>
          ) : null}
        </li>
      ))}
    </RelatedReadOnly>
  );
}

// ---------------------------------------------------------------------------
// Shifts: shift number links to the shift detail route, plus window and status.
// ---------------------------------------------------------------------------

export function MemberShiftsPanel({
  rows,
  isLoading,
}: {
  rows: ReadonlyArray<Shift>;
  isLoading: boolean;
}) {
  return (
    <RelatedReadOnly
      title="SHIFTS"
      entity="shift"
      explainer="Shifts roster this member onto a block of time. Place one from the shifts list."
      icon={CalendarClock}
      isLoading={isLoading}
      count={rows.length}
    >
      {rows.map((s) => (
        <li key={s.id} className={ROW_CLASS}>
          <Link to={`/kitforce/shifts/${s.id}`} className="underline font-mono">
            {s.shift_number ?? s.id.slice(0, 8)}
          </Link>
          <span className="ml-2 text-ink-dim text-xs">
            {formatDateTimeMedium(s.scheduled_start_at)}
          </span>
          <span className="ml-2 inline-flex">
            <StatusBadge status={s.status} />
          </span>
        </li>
      ))}
    </RelatedReadOnly>
  );
}
