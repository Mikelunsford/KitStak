import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import {
  useMember,
  useDeactivateMember,
  useReactivateMember,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';

/**
 * MemberDetailPage. Pillar 4. Mirrors FulfillmentDetailPage shape.
 *
 * State machine: active <-> inactive. Deactivate gates on
 * kitforce.member.deactivate; reactivate reuses the same capability (there is no
 * separate reactivate cap). Status renders as a simple inline pill.
 *
 * C2 rate gate: default hourly rate only renders when the caller holds
 * kitforce.member.read_rate (org_owner, accounting). The server strips the field
 * for everyone else.
 */
export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? '';

  const member = useMember(id);
  const deactivate = useDeactivateMember(memberId);
  const reactivate = useReactivateMember(memberId);

  const caps = useVioCapabilities();
  const canReadRate = caps.can('kitforce.member.read_rate');
  const canDeactivate = caps.can('kitforce.member.deactivate');

  if (member.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (member.error || !member.data) {
    return <p className="px-8 py-12 text-accent">Member not found.</p>;
  }
  const d = member.data;

  const isActive = d.status === 'active';

  function onDeactivate() {
    if (!destructiveConfirm({
      action: 'Deactivate this member',
      consequence: 'The member moves to inactive and stops appearing in active rosters. Time entries already recorded are kept.',
    })) return;
    deactivate.mutate({});
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Members', to: '/kitforce/members' },
          { label: d.member_number ?? d.display_name },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">{d.display_name}</h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {d.status}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isActive && canDeactivate && (
          <button
            onClick={onDeactivate}
            disabled={deactivate.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Deactivate
          </button>
        )}
        {!isActive && canDeactivate && (
          <button
            onClick={() => reactivate.mutate({})}
            disabled={reactivate.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Reactivate
          </button>
        )}
      </div>
      {deactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {deactivate.error instanceof Error ? deactivate.error.message : 'Deactivate failed.'}
        </p>
      ) : null}
      {reactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {reactivate.error instanceof Error ? reactivate.error.message : 'Reactivate failed.'}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Member number</dt>
        <dd className="text-ink font-mono">{d.member_number ?? 'None'}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd className="text-ink">{d.email ?? 'None'}</dd>
        <dt className="text-ink-dim">Phone</dt>
        <dd className="text-ink">{d.phone ?? 'None'}</dd>
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
        <dd className="text-ink">{d.created_at.slice(0, 10)}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="workforce_member" entityId={id ?? null} />
      </section>
    </section>
  );
}
