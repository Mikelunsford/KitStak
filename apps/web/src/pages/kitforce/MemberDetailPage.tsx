// MemberDetailPage. KitForce pillar. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (with the status as a StatusBadge in the
// meta slot and the lifecycle actions in the actions slot) replaces the
// hand-rolled header + raw status pill + button row. Members are a hub
// (active <-> inactive toggle, no FSM), so this stays single-column with the
// HISTORY section at the bottom (no DetailLayout).
//
// Preserved verbatim: the kitforce.member.read_rate gate on the default-rate
// field, the deactivate destructiveConfirm (reactivate fires directly), and
// the AuditTimeline.

import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useMember,
  useDeactivateMember,
  useReactivateMember,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';
import { formatDateMedium } from '@/lib/dates';

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? '';

  const member = useMember(id);
  const deactivate = useDeactivateMember(memberId);
  const reactivate = useReactivateMember(memberId);

  const caps = useVioCapabilities();
  const canReadRate = caps.can('kitforce.member.read_rate');
  const canDeactivate = caps.can('kitforce.member.deactivate');
  const canUpdate = caps.can('kitforce.member.update');

  if (member.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (member.error || !member.data) {
    return <p className="px-8 py-12 text-accent">Member not found.</p>;
  }
  const d = member.data;

  const isActive = d.status === 'active';

  async function onDeactivate() {
    if (
      !(await destructiveConfirm({
        action: 'Deactivate this member',
        consequence:
          'The member moves to inactive and stops appearing in active rosters. Time entries already recorded are kept.',
      }))
    )
      return;
    deactivate.mutate({});
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Members', to: '/kitforce/members' },
          { label: d.member_number ?? d.display_name },
        ]}
      />
      <PageHeader
        eyebrow="KitForce / Members"
        title={d.display_name}
        meta={<StatusBadge status={d.status} />}
        actions={
          <>
            {canUpdate && (
              <Link to={`/kitforce/members/${memberId}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
            {isActive && canDeactivate && (
              <Button
                variant="ghost"
                onClick={onDeactivate}
                disabled={deactivate.isPending}
              >
                Deactivate
              </Button>
            )}
            {!isActive && canDeactivate && (
              <Button
                variant="secondary"
                onClick={() => reactivate.mutate({})}
                disabled={reactivate.isPending}
              >
                Reactivate
              </Button>
            )}
          </>
        }
      />
      {deactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {deactivate.error instanceof Error
            ? deactivate.error.message
            : 'Deactivate failed.'}
        </p>
      ) : null}
      {reactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {reactivate.error instanceof Error
            ? reactivate.error.message
            : 'Reactivate failed.'}
        </p>
      ) : null}

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
        <AuditTimeline entityType="workforce_member" entityId={id ?? null} />
      </section>
    </section>
  );
}
