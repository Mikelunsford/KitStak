// TimeEntriesListPage. KitForce pillar. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable +
// Pagination replace the hand-rolled header, filter selects, and table. Time
// entries are a line-item class (no FSM, no status column), so there is no
// StatusBadge here. The inline clock-in form (with its kit-Select member
// picker), the per-row ClockOutButton component (each open entry owns its own
// mutation hook), the future-clock-in warning, formatMinutes, and the
// kitforce.member.read_rate gate on the Rate column are all preserved. Minutes
// is a duration, never money, so it does not go through formatCents.

import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import {
  useTimeEntriesList,
  useMembersList,
  useClockInTimeEntry,
  useClockOutTimeEntry,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import { formatDateTimeMedium } from '@/lib/dates';
import type { TimeEntry, TimeEntryClockIn } from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Minutes come off the wire as a numeric(18,4) value (e.g. "0.5667"). The raw
 * four-decimal float reads as a machine value in a labor table, so we round to
 * one decimal for display. Whole-minute durations render without a decimal.
 */
function formatMinutes(min: number | string | null | undefined): string {
  if (min === null || min === undefined || min === '') return '·';
  const n = typeof min === 'string' ? Number(min) : min;
  if (Number.isNaN(n)) return '·';
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Inline clock-out control. Each open entry owns its own mutation hook (hooks
 * cannot be called in a loop), so the row is extracted into its own component.
 */
function ClockOutButton({
  entryId,
  canClockOut,
}: {
  entryId: string;
  canClockOut: boolean;
}) {
  const clockOut = useClockOutTimeEntry(entryId);
  if (!canClockOut) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => clockOut.mutate({ clock_out_at: new Date().toISOString() })}
        disabled={clockOut.isPending}
        className={`${LINK_CLASS} text-xs text-left`}
      >
        {clockOut.isPending ? 'Saving.' : 'Clock out'}
      </button>
      {clockOut.error ? (
        <span className="text-accent text-xs">
          {clockOut.error instanceof Error
            ? clockOut.error.message
            : 'Clock-out failed.'}
        </span>
      ) : null}
    </div>
  );
}

export function TimeEntriesListPage() {
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { member_id?: string; open?: boolean } = {};
    if (memberFilter) f.member_id = memberFilter;
    if (openOnly) f.open = true;
    return f;
  }, [memberFilter, openOnly]);

  const entries = useTimeEntriesList(filters);
  const members = useMembersList();
  const clockIn = useClockInTimeEntry();
  const caps = useVioCapabilities();

  const canClockIn = caps.can('kitforce.time_entry.clock_in');
  const canClockOut = caps.can('kitforce.time_entry.clock_out');
  const canUpdate = caps.can('kitforce.time_entry.update');
  const canReadRate = caps.can('kitforce.member.read_rate');

  const [memberId, setMemberId] = useState('');
  const [clockInAt, setClockInAt] = useState('');
  const [rate, setRate] = useState('');

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  function applyMember(next: string) {
    setMemberFilter(next);
    setPage(0);
  }

  function applyOpenOnly(next: boolean) {
    setOpenOnly(next);
    setPage(0);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canClockIn || !memberId) return;
    const iso = localToIso(clockInAt) ?? new Date().toISOString();
    // The server snapshots the member rate at clock-in. Roles without read_rate
    // post 0; the value on the wire is overridden server-side from the member
    // record, so it is never authoritative here.
    const rateCents = canReadRate ? dollarsToCents(rate) ?? 0 : 0;
    const body: TimeEntryClockIn = {
      member_id: memberId,
      clock_in_at: iso,
      hourly_rate_cents: rateCents,
    };
    clockIn.mutate(body, {
      onSuccess: () => {
        setMemberId('');
        setClockInAt('');
        setRate('');
      },
    });
  }

  // Soft warning: clocking a member in at a future time is allowed (backfills
  // and pre-schedules happen) but is usually a typo, so flag it.
  const isFutureClockIn = (() => {
    const iso = localToIso(clockInAt);
    return iso !== null && new Date(iso).getTime() > Date.now();
  })();

  const columns = useMemo<ReadonlyArray<DataColumn<TimeEntry>>>(() => {
    const cols: DataColumn<TimeEntry>[] = [
      {
        key: 'member',
        header: 'Member',
        cellClassName: 'text-ink',
        render: (t) => memberName[t.member_id] ?? t.member_id.slice(0, 8),
      },
      {
        key: 'in',
        header: 'Clock-in',
        cellClassName: 'text-ink-dim',
        render: (t) => formatDateTimeMedium(t.clock_in_at),
      },
      {
        key: 'out',
        header: 'Clock-out',
        cellClassName: 'text-ink-dim',
        render: (t) =>
          t.clock_out_at ? formatDateTimeMedium(t.clock_out_at) : 'Open',
      },
      {
        key: 'minutes',
        header: 'Minutes',
        align: 'right',
        cellClassName: 'tabular-nums text-ink-dim',
        render: (t) => formatMinutes(t.minutes),
      },
    ];
    if (canReadRate) {
      cols.push({
        key: 'rate',
        header: 'Rate',
        align: 'right',
        cellClassName: 'tabular-nums text-ink-dim',
        render: (t) => `${formatCents(t.hourly_rate_cents, 'USD')}/hr`,
      });
    }
    cols.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <div className="flex flex-col items-end gap-1">
          {t.clock_out_at == null ? (
            <ClockOutButton entryId={t.id} canClockOut={canClockOut} />
          ) : null}
          {canUpdate ? (
            <Link
              to={`/kitforce/time-entries/${t.id}/edit`}
              className={`${LINK_CLASS} text-xs`}
            >
              Edit
            </Link>
          ) : null}
        </div>
      ),
    });
    return cols;
  }, [canReadRate, canClockOut, canUpdate, memberName]);

  const rows = entries.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !entries.isLoading && !entries.error
      ? `${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`
      : undefined;

  const chips: FilterChip[] = [];
  if (memberFilter) {
    chips.push({
      key: 'member',
      label: `Member: ${memberName[memberFilter] ?? memberFilter}`,
      onClear: () => applyMember(''),
    });
  }
  if (openOnly) {
    chips.push({ key: 'open', label: 'Open only', onClear: () => applyOpenOnly(false) });
  }

  const showOnboardingEmpty =
    !entries.isLoading &&
    !entries.error &&
    totalCount === 0 &&
    !memberFilter &&
    !openOnly;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="KitForce / Time entries" title="Time entries" meta={meta} />

      {canClockIn ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
              Member
            </span>
            <Select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
            >
              <option value="">Select a member</option>
              {(members.data ?? [])
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </Select>
          </label>
          <TextInput
            label="Clock-in (blank = now)"
            type="datetime-local"
            value={clockInAt}
            onChange={(e) => setClockInAt(e.target.value)}
          />
          {canReadRate ? (
            <TextInput
              label="Rate override $/hr (optional)"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          ) : null}
          <Button type="submit" disabled={!memberId || clockIn.isPending}>
            {clockIn.isPending ? 'Saving.' : 'Clock in'}
          </Button>
        </form>
      ) : null}
      {isFutureClockIn ? (
        <p className="text-amber-500 font-sans text-sm">
          This clock-in time is in the future. Double-check before clocking in.
        </p>
      ) : null}
      {clockIn.error ? (
        <p className="text-accent font-sans text-sm">
          {clockIn.error instanceof Error
            ? clockIn.error.message
            : 'Clock-in failed.'}
        </p>
      ) : null}

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Member
          </span>
          <Select
            value={memberFilter}
            onChange={(e) => applyMember(e.target.value)}
            disabled={members.isLoading}
            aria-label="Filter by member"
          >
            <option value="">All members</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => applyOpenOnly(e.target.checked)}
            className="accent-accent"
          />
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Open only
          </span>
        </label>
      </FilterBar>

      {entries.error ? (
        <p className="text-accent font-sans text-sm">
          {entries.error instanceof Error
            ? entries.error.message
            : 'Failed to load time entries.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="time entry"
          explainer="Time entries clock a member in and out so labor hours roll up into cost. Clock someone in to start."
          addLabel="Clock in"
          addTo="/kitforce/time-entries"
          canAdd={false}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(t) => t.id}
            loading={entries.isLoading}
            empty="No time entries match the current filters."
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
