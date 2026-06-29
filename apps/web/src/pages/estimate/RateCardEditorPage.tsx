// RateCardEditorPage. Settings surface for the Estimate Engine's pricing source.
// Edits the org's active rate card line by line: rates are entered in dollars
// and persisted as rate_micros (millionths of a currency unit), so the sub-cent
// per-unit rates the estimator needs survive precisely. Writes are gated on
// settings.write server-side (owner / admin); this page rides the adminOnly
// SETTINGS section in the sidebar.

import { useState, type FocusEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import {
  useActiveRateCard,
  useAddRateCardLine,
  usePatchRateCardLine,
  useDeleteRateCardLine,
} from '@/lib/hooks/useRateCards';
import type { RateCardLine } from '@/lib/types/estimate';

const MICROS_PER_UNIT = 1_000_000;

// Display order + titles for the rate groups. Unknown groups fall to the end
// under their raw key so a custom group_key still renders.
const GROUP_ORDER = [
  'constants', 'receiving', 'storage', 'shipping',
  'ecommerce', 'admin', 'materials', 'addons',
] as const;

const GROUP_TITLES: Record<string, string> = {
  constants: 'Cost & labor constants',
  receiving: 'Receiving / inbound',
  storage: 'Storage',
  shipping: 'Shipping / outbound',
  ecommerce: 'E-commerce / fulfillment',
  admin: 'Administration',
  materials: 'Materials & pallets',
  addons: 'Add-ons & change charges',
};

function microsToDollars(micros: number | string): string {
  return String(Number(micros) / MICROS_PER_UNIT);
}

function dollarsToMicros(dollars: string): number {
  const n = parseFloat(dollars);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * MICROS_PER_UNIT) : 0;
}

export function RateCardEditorPage() {
  const { data, isLoading } = useActiveRateCard();
  const cardId = data?.rate_card.id ?? '';

  const addLine = useAddRateCardLine(cardId);
  const patchLine = usePatchRateCardLine(cardId);
  const deleteLine = useDeleteRateCardLine(cardId);
  const [error, setError] = useState<string | null>(null);

  function onError(e: unknown) {
    setError(e instanceof Error ? e.message : 'Could not save the rate card.');
  }

  if (isLoading) {
    return (
      <section className="mx-auto max-w-4xl px-8 py-12">
        <PageHeader title="Rate card" />
        <p className="mt-6 text-sm text-ink-dim">Loading.</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-4xl px-8 py-12">
        <PageHeader title="Rate card" />
        <p className="mt-6 text-sm text-ink-dim">
          No rate card found for this organization. One is seeded by default; contact support if it is missing.
        </p>
      </section>
    );
  }

  const groups = [...GROUP_ORDER];
  for (const line of data.lines) {
    if (!groups.includes(line.group_key as (typeof GROUP_ORDER)[number])) {
      groups.push(line.group_key as (typeof GROUP_ORDER)[number]);
    }
  }

  function handleAdd(group: string) {
    setError(null);
    const code = 'CUSTOM-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const position = data ? data.lines.length : 0;
    addLine.mutate(
      { code, group_key: group, label: 'New line item', rate_micros: 0, uom: 'each', position },
      { onError },
    );
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Rate card"
        meta={`${data.rate_card.name} · ${data.lines.length} lines`}
      />
      <p className="text-sm text-ink-dim">
        The single source of truth for Estimate Engine pricing. Edit a rate and every estimate recalculates from it.
        Rates are entered in dollars and stored at sub-cent precision.
      </p>
      {error ? <p className="text-sm text-accent">{error}</p> : null}

      {groups.map((group) => {
        const rows = data.lines.filter((l) => l.group_key === group);
        return (
          <div key={group} className="border border-line bg-bg-2">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">
                {GROUP_TITLES[group] ?? group}
              </span>
              <Button
                variant="secondary"
                onClick={() => handleAdd(group)}
                disabled={addLine.isPending}
              >
                Add line
              </Button>
            </div>
            <div className="grid grid-cols-[110px_1fr_120px_130px_40px] items-center gap-2 border-b border-line px-5 py-2 text-[10px] uppercase tracking-wide text-ink-faint">
              <span>Code</span>
              <span>Service</span>
              <span>Unit</span>
              <span className="text-right">Rate ($)</span>
              <span />
            </div>
            {rows.map((row) => (
              <RateLineRow
                key={row.id}
                line={row}
                onCommit={(patch) => patchLine.mutate({ lineId: row.id, patch }, { onError })}
                onDelete={() => deleteLine.mutate(row.id, { onError })}
                disabled={patchLine.isPending || deleteLine.isPending}
              />
            ))}
            {rows.length === 0 ? (
              <div className="px-5 py-3 text-sm text-ink-faint">No lines in this group.</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

interface RateLineRowProps {
  line: RateCardLine;
  onCommit: (patch: { label?: string; uom?: string | null; rate_micros?: number }) => void;
  onDelete: () => void;
  disabled: boolean;
}

function RateLineRow({ line, onCommit, onDelete, disabled }: RateLineRowProps) {
  const [label, setLabel] = useState(line.label);
  const [uom, setUom] = useState(line.uom ?? '');
  const [rate, setRate] = useState(microsToDollars(line.rate_micros));

  const commitLabel = () => {
    if (label !== line.label) onCommit({ label });
  };
  const commitUom = () => {
    if ((uom || null) !== (line.uom ?? null)) onCommit({ uom: uom || null });
  };
  const commitRate = (e: FocusEvent<HTMLInputElement>) => {
    const micros = dollarsToMicros(e.target.value);
    if (micros !== Number(line.rate_micros)) onCommit({ rate_micros: micros });
  };

  return (
    <div className="grid grid-cols-[110px_1fr_120px_130px_40px] items-center gap-2 border-b border-line px-5 py-3">
      <span className="font-mono text-sm text-accent">{line.code}</span>
      <TextInput value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel} disabled={disabled} />
      <TextInput value={uom} onChange={(e) => setUom(e.target.value)} onBlur={commitUom} disabled={disabled} />
      <TextInput
        type="number"
        min={0}
        step={0.0001}
        className="text-right"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        onBlur={commitRate}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        title="Delete line"
        aria-label={`Delete ${line.code}`}
        className="text-lg leading-none text-ink-faint hover:text-danger disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
