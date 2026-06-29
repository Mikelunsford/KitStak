import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';

import { Segmented, FieldLabel } from './controls';
import { ENGINE_OPTIONS } from './options';
import { microsDisplay } from './format';
import type { EngineKind } from '@/lib/estimate/families';
import type { StepProps } from './stepProps';

const INFLATION_OPTIONS = [
  { value: '25', label: '25%' },
  { value: '30', label: '30%' },
  { value: '35', label: '35%' },
];

const MARKUP_OPTIONS = [
  { value: '0', label: '0x' },
  { value: '2.5', label: '2.5x' },
  { value: '3', label: '3.0x' },
];

// Step 2 - run the pricing engine the family points to. Time-study shows the
// full labor-cost to markup to sell build-up with a live margin check;
// touch / per-piece show a single sell figure; menu / flat defer to line items.
export function PricingStep({ state, result, set }: StepProps) {
  const { engine } = state;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextInput
          label={engine === 'flat' ? 'Accounts (qty)' : 'Units (qty)'}
          type="number"
          min={0}
          value={state.qty}
          onChange={(e) => set('qty', e.target.value)}
        />
        <div>
          <FieldLabel hint="How this family is priced. Set by default from the job family; change it here if needed.">
            Pricing engine
          </FieldLabel>
          <Select value={engine} onChange={(e) => set('engine', e.target.value as EngineKind)}>
            {ENGINE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {engine === 'timestudy' ? (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <FieldLabel>Time / unit (study)</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Min"
                  type="number"
                  min={0}
                  value={state.studyMin}
                  onChange={(e) => set('studyMin', e.target.value)}
                />
                <TextInput
                  label="Sec"
                  type="number"
                  min={0}
                  value={state.studySec}
                  onChange={(e) => set('studySec', e.target.value)}
                />
              </div>
            </div>
            <div>
              <FieldLabel hint="Padding added to the raw time study (25-35%) to cover receiving, staging, and line inefficiency.">
                Material handling
              </FieldLabel>
              <Segmented value={state.inflationPct} options={INFLATION_OPTIONS} onChange={(v) => set('inflationPct', v)} />
            </div>
          </div>

          <div>
            <FieldLabel hint="Multiplier on labor cost to reach the sell price. Standard 3x, floor 2.5x, or 0x for a loss-leader.">
              Markup on labor cost
            </FieldLabel>
            <Segmented value={state.markup} options={MARKUP_OPTIONS} onChange={(v) => set('markup', v)} />
          </div>

          <MetricsBox
            sell={microsDisplay(result.sellPerUnitMicros)}
            col={microsDisplay(result.colPerUnitMicros)}
            profit={microsDisplay(result.profitPerUnitMicros)}
            marginOk={result.marginOk}
          />
        </>
      ) : null}

      {engine === 'touch' ? (
        <div className="max-w-xs">
          <TextInput
            label="Touches / unit"
            type="number"
            min={0}
            value={state.touches}
            onChange={(e) => set('touches', e.target.value)}
          />
        </div>
      ) : null}

      {engine === 'perpiece' ? (
        <div className="max-w-xs">
          <TextInput
            label="Base rate ($ / piece)"
            type="number"
            min={0}
            step={0.01}
            value={state.baseRate}
            onChange={(e) => set('baseRate', e.target.value)}
          />
        </div>
      ) : null}

      {engine === 'menu' || engine === 'flat' ? (
        <p className="border border-line bg-bg-2 p-4 text-sm text-ink-dim">
          This family is priced from rate-card menu lines. Set the line quantities on the next step - no time study or markup.
        </p>
      ) : null}

      {engine === 'touch' || engine === 'perpiece' ? (
        <div className="inline-flex w-fit flex-col gap-1 border border-line bg-bg-2 px-5 py-3">
          <span className="text-xs uppercase tracking-wide text-ink-dim">Sell / unit</span>
          <span className="font-mono text-2xl text-accent">{microsDisplay(result.sellPerUnitMicros)}</span>
        </div>
      ) : null}
    </div>
  );
}

function MetricsBox({ sell, col, profit, marginOk }: { sell: string; col: string; profit: string; marginOk: boolean }) {
  return (
    <div className="flex flex-wrap gap-8 border border-line bg-bg-2 px-5 py-4">
      <Metric label="Sell / unit" value={sell} className="text-accent" />
      <Metric label="Labor cost / unit" value={col} className="text-ink" />
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-ink-dim">Profit / unit</span>
        <span className={`font-mono text-2xl ${marginOk ? 'text-success' : 'text-warning'}`}>{profit}</span>
        <span className={`text-xs ${marginOk ? 'text-success' : 'text-warning'}`}>
          {marginOk ? 'Meets 2.5x labor floor' : 'Below 2.5x labor floor'}
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-ink-dim">{label}</span>
      <span className={`font-mono text-2xl ${className}`}>{value}</span>
    </div>
  );
}
