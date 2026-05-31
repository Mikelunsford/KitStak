import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import {
  useTimeEntriesList,
  useMembersList,
  useClockInTimeEntry,
  useClockOutTimeEntry,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import type { TimeEntryClockIn } from '@/lib/types/kitforce';

/**
 * TimeEntriesListPage. Pillar 4. Time entries are a line-item class (no parent
 * FSM): clock-in opens an entry, clock-out closes it and derives minutes.
 *
 * Clock-in gates on kitforce.time_entry.clock_in; clock-out on
 * kitforce.time_entry.clock_out.
 *
 * C2 rate gate: hourly_rate_cents only renders when the caller holds
 * kitforce.member.read_rate (org_owner, accounting). The server strips the field
 * for everyone else, and snapshots the member rate at clock-in regardless of
 * what the wire carries. Roles without the cap post 0 and never see the column.
 */
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
function ClockOutButton({ entryId, canClockOut }: { entryId: string; canClockOut: boolean }) {
  const clockOut = useClockOutTimeEntry(entryId);
  if (!canClockOut) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => clockOut.mutate({ clock_out_at: new Date().toISOString() })}
        disabled={clockOut.isPending}
        className="text-ink underline text-xs text-left"
      >
        {clockOut.isPending ? 'Saving.' : 'Clock out'}
      </button>
      {clockOut.error ? (
        <span className="text-accent text-xs">
          {clockOut.error instanceof Error ? clockOut.error.message : 'Clock-out failed.'}
        </span>
      ) : null}
    </div>
  );
}

export function TimeEntriesListPage() {
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [openOnly, setOpenOnly] = useState(false);

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
  const canReadRate = caps.can('kitforce.member.read_rate');

  const [memberId, setMemberId] = useState('');
  const [clockInAt, setClockInAt] = useState('');
  const [rate, setRate] = useState('');

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

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

  const rateColSpan = canReadRate ? 6 : 5;

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-display tracking-wide text-ink">TIME ENTRIES</h1>
      </header>

      {canClockIn ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
              className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">Select a member</option>
              {(members.data ?? [])
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </select>
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
      {clockIn.error ? (
        <p className="text-accent font-sans text-sm">
          {clockIn.error instanceof Error ? clockIn.error.message : 'Clock-in failed.'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            disabled={members.isLoading}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">All members</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="accent-accent"
          />
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Open only</span>
        </label>
      </div>

      {entries.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {entries.error ? (
        <p className="text-accent font-sans text-sm">
          {entries.error instanceof Error ? entries.error.message : 'Failed to load time entries.'}
        </p>
      ) : null}

      {!entries.isLoading && (entries.data ?? []).length === 0 && !memberFilter && !openOnly ? (
        <ListEmptyState
          entity="time entry"
          explainer="Time entries clock a member in and out so labor hours roll up into cost. Clock someone in to start."
          addLabel="Clock in"
          addTo="/kitforce/time-entries"
          canAdd={false}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Clock-in</th>
              <th className="px-4 py-2">Clock-out</th>
              <th className="px-4 py-2">Minutes</th>
              {canReadRate ? <th className="px-4 py-2">Rate</th> : null}
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(entries.data ?? []).length === 0 && !entries.isLoading ? (
              <tr>
                <td colSpan={rateColSpan} className="px-4 py-6 text-ink-dim text-sm">
                  No time entries match the current filters.
                </td>
              </tr>
            ) : (
              (entries.data ?? []).map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-2 text-ink">
                    {memberName[t.member_id] ?? t.member_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-ink-dim font-mono">
                    {t.clock_in_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2 text-ink-dim font-mono">
                    {t.clock_out_at ? t.clock_out_at.slice(0, 16).replace('T', ' ') : 'Open'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim font-mono">{formatMinutes(t.minutes)}</td>
                  {canReadRate ? (
                    <td className="px-4 py-2 text-ink-dim font-mono">
                      {`${formatCents(t.hourly_rate_cents, 'USD')}/hr`}
                    </td>
                  ) : null}
                  <td className="px-4 py-2">
                    {t.clock_out_at == null ? (
                      <ClockOutButton entryId={t.id} canClockOut={canClockOut} />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
