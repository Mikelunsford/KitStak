import { Button } from '@/components/ui/Button';
import type { EstimateLineItem, EstimateResult } from '@/lib/estimate/engine';
import { FAMILIES } from '@/lib/estimate/families';

import { centsWhole, shortDate } from './format';
import type { EngineState } from './engineState';

interface ResultStepProps {
  state: EngineState;
  result: EstimateResult;
  validUntil: string;
  customerSelected: boolean;
  converting: boolean;
  error: string | null;
  onConvert: () => void;
  onEditScope: () => void;
}

// Step 4 - the finished estimate as an itemized internal breakdown plus the
// totals rail. Converting creates a real quote through estimates-api (the one
// quote engine), so there is no faux quote letterhead here; the operator lands
// on the actual quote after convert.
export function ResultStep(props: ResultStepProps) {
  const { state, result } = props;
  const fam = FAMILIES[state.family] ?? FAMILIES.display;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-sans text-2xl font-semibold text-ink">Estimate summary</h2>
          <p className="text-sm text-ink-dim">
            {(state.projectName || 'Untitled')} · {fam.label} · ship {shortDate(state.goLive)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Section title="Production" totalCents={result.productionCents} items={result.productionItems} />
          <Section title="Pass-throughs & materials" totalCents={result.passThroughCents} items={result.passThroughItems} />
        </div>

        <div className="sticky top-6 flex flex-col gap-4 border border-line bg-bg-2 p-6">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-faint">Quote totals</span>
          <Total label="Production" value={centsWhole(result.productionCents)} />
          <Total label="Pass-throughs & materials" value={centsWhole(result.passThroughCents)} />
          <div className="border border-line bg-bg p-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-ink-dim">Total project estimate</div>
            <div className="text-4xl font-semibold text-ink">{centsWhole(result.totalCents)}</div>
            {result.minApplied ? (
              <div className="mt-1 text-xs text-ink-dim">
                $500 project minimum applied · raw {centsWhole(result.rawCents)}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2.5">
            <Button
              className="w-full"
              onClick={props.onConvert}
              disabled={props.converting || !props.customerSelected}
            >
              {props.converting ? 'Converting.' : 'Convert to quote'}
            </Button>
            <Button variant="secondary" className="w-full" onClick={props.onEditScope}>
              Edit scope
            </Button>
          </div>
          {!props.customerSelected ? (
            <p className="text-xs text-warning">Choose a customer in step 1 before converting to a quote.</p>
          ) : null}
          {props.error ? <p className="text-xs text-accent">{props.error}</p> : null}
          <p className="text-xs leading-relaxed text-ink-faint">
            Valid through {props.validUntil}. Converting creates a sendable quote on the customer record.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, totalCents, items }: { title: string; totalCents: number; items: ReadonlyArray<EstimateLineItem> }) {
  return (
    <div className="border border-line bg-bg-2">
      <div className="flex items-center justify-between p-5">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">{title}</span>
        <span className="text-2xl font-semibold text-ink">{centsWhole(totalCents)}</span>
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 border-t border-line px-5 py-3.5">
          <div className="flex flex-col">
            <span className="text-sm text-ink">{it.label}</span>
            <span className="text-xs text-ink-dim">{it.detail}</span>
          </div>
          <span className="whitespace-nowrap font-mono text-sm text-ink">{centsWhole(it.amountCents)}</span>
        </div>
      ))}
      {items.length === 0 ? (
        <div className="border-t border-line px-5 py-3.5 text-sm text-ink-faint">No lines</div>
      ) : null}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-ink-dim">{label}</div>
      <div className="text-3xl font-semibold text-ink">{value}</div>
    </div>
  );
}
