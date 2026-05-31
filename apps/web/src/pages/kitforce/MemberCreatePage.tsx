import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateMember } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkforceMemberCreate } from '@/lib/types/kitforce';

/**
 * MemberCreatePage. Pillar 4. Mirrors SalesOrderCreatePage.
 *
 * member_number is auto-assigned by the kitforce-api handler via next_doc_number
 * when left blank (EMP- prefix). The member opens active.
 *
 * C2 rate gate: the default hourly rate input only renders when the caller holds
 * kitforce.member.read_rate (org_owner, accounting). Roles that manage members
 * but not compensation (ops) never see or submit a rate. The dollar input is
 * converted to integer cents before posting; never float math on the wire.
 */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function MemberCreatePage() {
  const navigate = useNavigate();
  const create = useCreateMember();
  const caps = useVioCapabilities();

  const [memberNumber, setMemberNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = caps.can('kitforce.member.create');
  const canReadRate = caps.can('kitforce.member.read_rate');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    const body: WorkforceMemberCreate = { display_name: displayName.trim() };
    if (memberNumber.trim()) body.member_number = memberNumber.trim();
    if (email.trim()) body.email = email.trim();
    if (phone.trim()) body.phone = phone.trim();
    if (notes.trim()) body.notes = notes.trim();
    if (canReadRate) {
      const cents = dollarsToCents(rate);
      if (cents != null) body.default_hourly_rate_cents = cents;
    }

    create.mutate(body, {
      onSuccess: (member) => {
        navigate(`/kitforce/members/${member.id}`);
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW MEMBER</h1>
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create members.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Member number (auto-assigned if blank, e.g. EMP-2026-00001)"
          value={memberNumber}
          onChange={(e) => setMemberNumber(e.target.value)}
        />
        <TextInput
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <TextInput
          label="Email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextInput
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {canReadRate ? (
          <TextInput
            label="Default hourly rate in dollars (optional, e.g. 24.50)"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        ) : null}
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {create.error ? (
          <p className="text-accent font-sans text-sm">
            {create.error instanceof Error ? create.error.message : 'Create failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canCreate || !displayName.trim() || create.isPending}>
            {create.isPending ? 'Saving.' : 'Create member'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/kitforce/members')}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
