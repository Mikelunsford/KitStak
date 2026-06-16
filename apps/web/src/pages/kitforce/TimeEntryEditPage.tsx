import { useState, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { useTimeEntriesList, useUpdateTimeEntry } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { TimeEntryPatch } from '@/lib/types/kitforce';

/**
 * TimeEntryEditPage. Pillar 4. F-Wave10-KITFORCE-TIME-ENTRY-EDIT-01.
 *
 * The time-entries list exposed clock-in and clock-out but no way to correct a
 * clock-in timestamp, fix a clock-out time, or update notes after the fact.
 * Operators need this for shift backfills and typo corrections.
 *
 * Editable fields: clock_in_at, clock_out_at, hourly_rate_cents, notes.
 * member_id is structural identity and is never editable here.
 * The rate field is gated on kitforce.member.read_rate (C2 rate gate).
 *
 * There is no getTimeEntry(id) service endpoint; the entry is resolved from the
 * list cache (same pattern as TeamEditPage), which is always warm when the
 * operator navigates from the list page.
 *
 * Capability gate: kitforce.time_entry.update.
 */

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToDollars(cents: number | string | null | undefined): string {
  if (cents == null) return '';
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (Number.isNaN(n)) return '';
  return (n / 100).toFixed(2);
}

// ISO -> "YYYY-MM-DDTHH:mm" in local time for a datetime-local input.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function TimeEntryEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const entryId = id ?? '';

  const entries = useTimeEntriesList();
  const update = useUpdateTimeEntry(entryId);
  const caps = useVioCapabilities();

  const canUpdate = caps.can('kitforce.time_entry.update');
  const canReadRate = caps.can('kitforce.member.read_rate');

  const entry = useMemo(
    () => (entries.data ?? []).find((e) => e.id === entryId),
    [entries.data, entryId],
  );

  // Local edit state; null means "not yet touched, read from loaded row".
  const [clockInAt, setClockInAt] = useState<string | null>(null);
  const [clockOutAt, setClockOutAt] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (entries.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (!entry) return <p className="px-8 py-12 text-accent">Time entry not found.</p>;

  const vClockIn = clockInAt ?? isoToLocalInput(entry.clock_in_at);
  const vClockOut = clockOutAt ?? isoToLocalInput(entry.clock_out_at);
  const vRate = rate ?? centsToDollars(entry.hourly_rate_cents);
  const vNotes = notes ?? entry.notes ?? '';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canUpdate) return;
    const clockInIso = localToIso(vClockIn);
    if (!clockInIso) return;
    const body: TimeEntryPatch = {
      clock_in_at: clockInIso,
      clock_out_at: localToIso(vClockOut) ?? undefined,
      notes: vNotes.trim() ? vNotes.trim() : null,
    };
    if (canReadRate) {
      const cents = dollarsToCents(vRate);
      if (cents !== null) body.hourly_rate_cents = cents;
    }
    update.mutate(body, {
      onSuccess: () => navigate('/kitforce/time-entries'),
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="KitForce / Time entries" title="Edit time entry" />
      {!canUpdate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to edit time entries.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Clock-in"
          type="datetime-local"
          value={vClockIn}
          onChange={(e) => setClockInAt(e.target.value)}
          required
        />
        <TextInput
          label="Clock-out (blank if still open)"
          type="datetime-local"
          value={vClockOut}
          onChange={(e) => setClockOutAt(e.target.value)}
        />
        {canReadRate ? (
          <TextInput
            label="Hourly rate in dollars (e.g. 24.50)"
            inputMode="decimal"
            value={vRate}
            onChange={(e) => setRate(e.target.value)}
          />
        ) : null}

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={vNotes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {update.error ? (
          <p className="text-accent font-sans text-sm">
            {update.error instanceof Error ? update.error.message : 'Save failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canUpdate || !vClockIn || update.isPending}>
            {update.isPending ? 'Saving.' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/kitforce/time-entries')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
