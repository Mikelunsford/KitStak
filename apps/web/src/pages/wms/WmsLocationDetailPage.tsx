// WmsLocationDetailPage (Wave 12 Body B Phase B1). The WMS location hub: key
// fields and a HISTORY rail (the audit timeline). HUB-style detail pages SET
// the eyebrow (FSM detail pages omit it); a location is a config row, not a
// registered FSM, so the eyebrow is set and there is no StateStepper. active
// moves via the deactivate action, gated on wms.location.deactivate.

import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useWmsLocation,
  useDeactivateWmsLocation,
} from '@/lib/hooks/useWmsLocations';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

export function WmsLocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locationId = id ?? '';
  const location = useWmsLocation(id);
  const deactivate = useDeactivateWmsLocation(locationId);
  const caps = useCapabilities();

  if (location.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (location.error || !location.data) {
    return <p className="px-8 py-12 text-accent">Location not found.</p>;
  }
  const d = location.data;
  const canDeactivate = caps.can('wms.location.deactivate');

  const onDeactivate = async () => {
    const ok = await destructiveConfirm({
      action: 'Deactivate this location',
      consequence:
        'The location moves to inactive and drops out of the active list. The record stays for audit and any bin history.',
    });
    if (!ok) return;
    deactivate.mutate();
  };

  const statusAction =
    canDeactivate && d.active ? (
      <Button
        variant="secondary"
        onClick={onDeactivate}
        disabled={deactivate.isPending}
      >
        {deactivate.isPending ? 'Deactivating.' : 'Deactivate'}
      </Button>
    ) : null;

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Locations', to: '/wms/locations' },
          { label: d.code },
        ]}
      />
      <PageHeader eyebrow="WMS" title={d.code} actions={statusAction} />

      {deactivate.error && (
        <p className="font-sans text-sm text-accent">
          {deactivate.error instanceof Error
            ? deactivate.error.message
            : 'Status change failed.'}
        </p>
      )}

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="warehouse_location" entityId={id ?? null} />
          </section>
        }
      >
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Code</dt>
          <dd className="text-ink font-mono">{d.code}</dd>
          <dt className="text-ink-dim">Type</dt>
          <dd className="text-ink capitalize">{d.location_type}</dd>
          <dt className="text-ink-dim">Warehouse</dt>
          <dd className="text-ink">
            <EntityLabel kind="warehouse" id={d.warehouse_id} />
          </dd>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink">
            <StatusBadge status={d.active ? 'active' : 'inactive'} />
          </dd>
          <dt className="text-ink-dim">Created</dt>
          <dd className="text-ink">{formatDate(d.created_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink">{d.notes ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
