import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useMember, useUpdateMember } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkforceMemberPatch } from '@/lib/types/kitforce';

/**
 * MemberEditPage. Pillar 4. F-Wave10-SMOKE-MEMBER-EDIT-01.
 *
 * The member detail page previously exposed only Deactivate; there was no way
 * to fix a typo in a name, email, phone, rate, or notes (the /edit route 404'd).
 * This page mirrors MemberCreatePage but prefills from the existing member and
 * PATCHes via useUpdateMember. member_number and status are not editable here
 * (number is chassis-assigned; status moves via deactivate/reactivate).
 *
 * C2 rate gate: the rate input only renders when the caller holds
 * kitforce.member.read_rate. The dollar input converts to integer cents; never
 * float math on the wire.
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

export function MemberEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? '';

  const member = useMember(id);
  const update = useUpdateMember(memberId);
  const caps = useVioCapabilities();

  const canUpdate = caps.can('kitforce.member.update');
  const canReadRate = caps.can('kitforce.member.read_rate');

  // Form state is seeded once from the loaded member via lazy initialisers
  // keyed on the query data; until the member loads the inputs stay empty.
  const d = member.data;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (member.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (member.error || !d) {
    return <p className="px-8 py-12 text-accent">Member not found.</p>;
  }

  // Resolve the effective value: the local edit if touched, else the loaded row.
  const vName = displayName ?? d.display_name;
  const vEmail = email ?? d.email ?? '';
  const vPhone = phone ?? d.phone ?? '';
  const vRate = rate ?? centsToDollars(d.default_hourly_rate_cents);
  const vNotes = notes ?? d.notes ?? '';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canUpdate) return;
    const body: WorkforceMemberPatch = {
      display_name: vName.trim(),
      email: vEmail.trim() ? vEmail.trim() : null,
      phone: vPhone.trim() ? vPhone.trim() : null,
      notes: vNotes.trim() ? vNotes.trim() : null,
    };
    if (canReadRate) {
      body.default_hourly_rate_cents = dollarsToCents(vRate);
    }
    update.mutate(body, {
      onSuccess: () => navigate(`/kitforce/members/${memberId}`),
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT MEMBER</h1>
      {!canUpdate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to edit members.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Display name"
          value={vName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <TextInput
          label="Email (optional)"
          type="email"
          value={vEmail}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextInput
          label="Phone (optional)"
          value={vPhone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {canReadRate ? (
          <TextInput
            label="Default hourly rate in dollars (optional, e.g. 24.50)"
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
          <Button type="submit" disabled={!canUpdate || !vName.trim() || update.isPending}>
            {update.isPending ? 'Saving.' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/kitforce/members/${memberId}`)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
