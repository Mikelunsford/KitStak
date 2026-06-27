// ExportsPage. Pick an entity, download an authenticated CSV stream as a Blob.

import { useState } from 'react';

import { triggerExport } from '@/lib/services/exportsService';
import type { ExportEntityType } from '@/lib/types/cross_cutting';

const ENTITIES: Array<{ key: ExportEntityType; label: string }> = [
  { key: 'customer', label: 'Customers' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'payment', label: 'Payments' },
  { key: 'journal_entry', label: 'Journal entries' },
  { key: 'expense', label: 'Expenses' },
  { key: 'stock_movement', label: 'Stock movements' },
  { key: 'shipment', label: 'Shipments' },
  { key: 'vendor_bill', label: 'Vendor bills' },
];

export function ExportsPage() {
  const [pendingKey, setPendingKey] = useState<ExportEntityType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDownload(key: ExportEntityType): Promise<void> {
    setError(null);
    setPendingKey(key);
    try {
      await triggerExport(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-ink">
          EXPORTS
        </h1>
        <p className="text-sm text-ink-dim">
          Download CSV snapshots of your workspace. Currency amounts are
          emitted as integer cents.
        </p>
      </header>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {ENTITIES.map((e) => (
          <li
            key={e.key}
            className="flex items-center justify-between border border-line bg-bg-2 px-3 py-2"
          >
            <span className="text-sm text-ink">{e.label}</span>
            <button
              type="button"
              onClick={() => void onDownload(e.key)}
              disabled={pendingKey === e.key}
              className="border border-line px-2 py-1 text-xs hover:bg-bg-3 disabled:opacity-50"
            >
              {pendingKey === e.key ? 'Downloading.' : 'Download CSV'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
