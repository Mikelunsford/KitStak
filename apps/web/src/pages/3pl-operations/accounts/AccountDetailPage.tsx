// AccountDetailPage (Wave 12 Phase A1). The 3PL account hub: key fields, the
// per-account service-definitions (Rate Card) section, and a HISTORY rail
// (the audit timeline). HUB-style detail pages SET the eyebrow (FSM detail
// pages omit it); an account is a hub, not a registered FSM, so the eyebrow is
// set and there is no StateStepper. Status moves via the deactivate /
// reactivate actions, gated on threepl.account.deactivate.

import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useAccount,
  useDeactivateAccount,
  useReactivateAccount,
} from '@/lib/hooks/useAccounts';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

import { AccountServiceDefinitions } from './AccountServiceDefinitions';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accountId = id ?? '';
  const account = useAccount(id);
  const deactivate = useDeactivateAccount(accountId);
  const reactivate = useReactivateAccount(accountId);
  const caps = useCapabilities();

  if (account.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (account.error || !account.data) {
    return <p className="px-8 py-12 text-accent">Account not found.</p>;
  }
  const d = account.data;
  const canToggleStatus = caps.can('threepl.account.deactivate');
  const togglePending = deactivate.isPending || reactivate.isPending;
  const toggleError = deactivate.error || reactivate.error;

  const onDeactivate = async () => {
    const ok = await destructiveConfirm({
      action: 'Deactivate this account',
      consequence:
        'The account moves to inactive and drops out of the active list. You can reactivate it later.',
    });
    if (!ok) return;
    deactivate.mutate();
  };

  const statusAction = canToggleStatus ? (
    d.status === 'active' ? (
      <Button variant="secondary" onClick={onDeactivate} disabled={togglePending}>
        {deactivate.isPending ? 'Deactivating.' : 'Deactivate'}
      </Button>
    ) : (
      <Button
        variant="secondary"
        onClick={() => reactivate.mutate()}
        disabled={togglePending}
      >
        {reactivate.isPending ? 'Reactivating.' : 'Reactivate'}
      </Button>
    )
  ) : null;

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Accounts', to: '/3pl-operations/accounts' },
          { label: d.name },
        ]}
      />
      <PageHeader title={d.name} actions={statusAction} />

      {toggleError && (
        <p className="font-sans text-sm text-accent">
          {toggleError instanceof Error ? toggleError.message : 'Status change failed.'}
        </p>
      )}

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="three_pl_account" entityId={id ?? null} />
          </section>
        }
      >
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Account number</dt>
          <dd className="text-ink tabular-nums">{d.account_number ?? ''}</dd>
          <dt className="text-ink-dim">Customer</dt>
          <dd className="text-ink">
            <EntityLabel kind="customer" id={d.customer_id} />
          </dd>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink">
            <StatusBadge status={d.status} />
          </dd>
          <dt className="text-ink-dim">Created</dt>
          <dd className="text-ink">{formatDate(d.created_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink">{d.notes ?? ''}</dd>
        </dl>

        <AccountServiceDefinitions accountId={accountId} />
      </DetailLayout>
    </section>
  );
}
