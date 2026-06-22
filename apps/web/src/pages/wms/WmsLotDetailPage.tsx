// WmsLotDetailPage (Wave 12 Body B Phase B4). The WMS lot hub: key fields and a
// HISTORY rail (the audit timeline). lots is a near-config table with one minimal
// hold transition (quarantine), so it is treated as a HUB: the detail SETS the
// eyebrow (FSM detail pages omit it) and there is no StateStepper. The quarantine
// action is gated to an active lot plus wms.lot.quarantine; the server is
// authority.

import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWmsLot, useQuarantineWmsLot } from '@/lib/hooks/useWmsLots';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function WmsLotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const lotId = id ?? '';
  const lot = useWmsLot(id);
  const quarantine = useQuarantineWmsLot(lotId);
  const caps = useCapabilities();

  if (lot.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (lot.error || !lot.data) {
    return <p className="px-8 py-12 text-accent">Lot not found.</p>;
  }
  const d = lot.data;
  const canQuarantine = caps.can('wms.lot.quarantine') && d.status === 'active';

  const onQuarantine = async () => {
    const ok = await destructiveConfirm({
      action: 'Quarantine this lot',
      consequence:
        'The lot moves to quarantined and is held from use. The record stays for audit and any bin history.',
    });
    if (!ok) return;
    quarantine.mutate();
  };

  const statusAction = canQuarantine ? (
    <Button
      variant="secondary"
      onClick={onQuarantine}
      disabled={quarantine.isPending}
    >
      {quarantine.isPending ? 'Quarantining.' : 'Quarantine'}
    </Button>
  ) : null;

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Lots', to: '/wms/lots' },
          { label: d.lot_code },
        ]}
      />
      <PageHeader title={d.lot_code} actions={statusAction} />

      {quarantine.error && (
        <p className="font-sans text-sm text-accent">
          {quarantine.error instanceof Error
            ? quarantine.error.message
            : 'Status change failed.'}
        </p>
      )}

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="lot" entityId={id ?? null} />
          </section>
        }
      >
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Lot code</dt>
          <dd className="text-ink font-mono">{d.lot_code}</dd>
          <dt className="text-ink-dim">Item</dt>
          <dd className="text-ink">
            <EntityLabel kind="item" id={d.item_id} />
          </dd>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink">
            <StatusBadge status={d.status} />
          </dd>
          <dt className="text-ink-dim">Expires</dt>
          <dd className="text-ink">{formatDate(d.expiration_date)}</dd>
          <dt className="text-ink-dim">Received</dt>
          <dd className="text-ink">{d.received_at ? formatDate(d.received_at) : ''}</dd>
          <dt className="text-ink-dim">Created</dt>
          <dd className="text-ink">{formatTimestamp(d.created_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink">{d.notes ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
