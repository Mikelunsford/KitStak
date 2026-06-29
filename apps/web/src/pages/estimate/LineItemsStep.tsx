import { Segmented, NumberStepper } from './controls';
import { INBOUND_MODE_OPTIONS } from './options';
import { centsWhole, microsDisplay } from './format';
import {
  FAMILIES,
  type LineKey,
  type PalletGrade,
} from '@/lib/estimate/families';
import { microsToCents } from '@/lib/estimate/engine';
import { rateMicrosOf, type RateCardLine as EngineRateCardLine } from '@/lib/estimate/rateCard';
import { defaultLineQty, parseField, type EngineState } from './engineState';
import type { StepProps } from './stepProps';

const GRADE_OPTIONS: { value: PalletGrade; label: string }[] = [
  { value: 'b', label: 'Grade B' },
  { value: 'a', label: 'Grade A / CHEP' },
];

interface LineDescriptor {
  key: LineKey;
  field: keyof EngineState;
  label: string;
  rateHint: string;
  amountCents: number;
  step: number;
  extra?: 'mode' | 'grade' | 'months';
}

const LINE_FIELD: Record<LineKey, keyof EngineState> = {
  inbound: 'inboundPallets',
  palletsOut: 'palletsOut',
  labelQty: 'labelQty',
  storagePallets: 'storagePallets',
  ecomOrders: 'ecomOrders',
  ecomPieces: 'ecomPieces',
  programmingHrs: 'programmingHrs',
  shopHours: 'shopHours',
  machineHours: 'machineHours',
  rawMaterials: 'rawMaterialUnits',
};

// Editable line cards for the active family. Amounts mirror the pricing engine
// (rateMicrosOf on the same card) so the editor and the totals agree; palletsOut
// shows one combined pallet+wrap card here, split in the final estimate.
function describeLines(
  state: EngineState,
  card: ReadonlyArray<EngineRateCardLine>,
): LineDescriptor[] {
  const fam = FAMILIES[state.family] ?? FAMILIES.display;
  const n = (field: keyof EngineState) => parseField(String(state[field]));
  const cents = (micros: number) => microsToCents(micros);

  const nStoP = n('storagePallets');
  const storTier = nStoP >= 500 ? 'STO-T3' : nStoP >= 100 ? 'STO-T2' : 'STO-T1';
  const storTierLabel = nStoP >= 500 ? '500+' : nStoP >= 100 ? '100-499' : '1-99';
  const pgCode = state.palletGrade === 'a' ? 'MAT-PALLET-A' : 'MAT-PALLET-B';
  const rcvCode = state.inboundMode === 'case' ? 'RCV-CASE-U40' : state.inboundMode === 'case_heavy' ? 'RCV-CASE-O40' : 'RCV-PALLET';
  const rcvUnit = state.inboundMode === 'pallet' ? 'pallet' : 'case';

  const meta: Record<LineKey, Omit<LineDescriptor, 'key' | 'field'>> = {
    inbound: {
      label: 'Inbound receiving',
      rateHint: `${microsDisplay(rateMicrosOf(card, rcvCode))} / ${rcvUnit}`,
      amountCents: cents(n('inboundPallets') * rateMicrosOf(card, rcvCode)),
      step: 1, extra: 'mode',
    },
    palletsOut: {
      label: 'Shipping pallets out',
      rateHint: `pallet + ${microsDisplay(rateMicrosOf(card, 'SHP-WRAP'))} wrap`,
      amountCents: cents(n('palletsOut') * (rateMicrosOf(card, pgCode) + rateMicrosOf(card, 'SHP-WRAP'))),
      step: 1, extra: 'grade',
    },
    labelQty: {
      label: 'Additional labels',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'ADD-LABEL-APP'))} / label`,
      amountCents: cents(n('labelQty') * rateMicrosOf(card, 'ADD-LABEL-APP')),
      step: 25,
    },
    storagePallets: {
      label: 'Storage',
      rateHint: `${storTierLabel} tier · per pallet / mo`,
      amountCents: cents(nStoP * n('storageMonths') * rateMicrosOf(card, storTier)),
      step: 1, extra: 'months',
    },
    ecomOrders: {
      label: 'E-com orders (pull+pack+doc)',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'ECM-ORDER'))} / order`,
      amountCents: cents(n('ecomOrders') * rateMicrosOf(card, 'ECM-ORDER')),
      step: 25,
    },
    ecomPieces: {
      label: 'Additional pieces pulled',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'ECM-PIECE'))} / piece`,
      amountCents: cents(n('ecomPieces') * rateMicrosOf(card, 'ECM-PIECE')),
      step: 25,
    },
    programmingHrs: {
      label: 'Programming / WMS config',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'ADM-PROG'))} / hr`,
      amountCents: cents(n('programmingHrs') * rateMicrosOf(card, 'ADM-PROG')),
      step: 1,
    },
    shopHours: {
      label: 'Shop hours (billable)',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'ADM-SHOP'))} / hr`,
      amountCents: cents(n('shopHours') * rateMicrosOf(card, 'ADM-SHOP')),
      step: 1,
    },
    machineHours: {
      label: 'Machine time',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'MFG-MACHINE-HR'))} / hr`,
      amountCents: cents(n('machineHours') * rateMicrosOf(card, 'MFG-MACHINE-HR')),
      step: 1,
    },
    rawMaterials: {
      label: 'Raw materials',
      rateHint: `${microsDisplay(rateMicrosOf(card, 'MFG-RAW-UNIT'))} / unit`,
      amountCents: cents(n('rawMaterialUnits') * rateMicrosOf(card, 'MFG-RAW-UNIT')),
      step: 25,
    },
  };

  // rawMaterials only bills when materials are sourced (org-supplied); hide the
  // card otherwise so the wizard matches the engine's gating.
  return fam.lines
    .filter((key) => key !== 'rawMaterials' || state.materials === 'sourced')
    .map((key) => ({ key, field: LINE_FIELD[key], ...meta[key] }));
}

// Step 3 - pick the rate-card pass-through lines for this family. Each is a
// toggleable card with a quantity stepper; some carry an extra control.
export function LineItemsStep({ state, set, card }: StepProps) {
  const lines = describeLines(state, card);
  const fam = FAMILIES[state.family] ?? FAMILIES.display;

  const stepBy = (field: keyof EngineState, delta: number) =>
    set(field, String(Math.max(0, parseField(String(state[field])) + delta)) as never);

  return (
    <div className="flex flex-col gap-3">
      {lines.map((ln) => {
        const value = parseField(String(state[ln.field]));
        const on = value > 0;
        return (
          <div
            key={ln.key}
            className={`border p-4 transition ${on ? 'border-accent bg-accent-soft' : 'border-line bg-bg'}`}
          >
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => set(ln.field, (on ? '0' : String(defaultLineQty(ln.key, parseField(state.qty)))) as never)}
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center border text-xs ${
                  on ? 'border-accent bg-accent text-on-primary' : 'border-line'
                }`}
                aria-label={on ? `Remove ${ln.label}` : `Add ${ln.label}`}
              >
                {on ? '✓' : ''}
              </button>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-ink">{ln.label}</span>
                <span className="text-xs text-ink-dim">{ln.rateHint}</span>
              </div>
              {on ? (
                <div className="ml-auto flex items-center gap-3.5">
                  <NumberStepper
                    value={String(state[ln.field])}
                    onDec={() => stepBy(ln.field, -ln.step)}
                    onInc={() => stepBy(ln.field, ln.step)}
                    onChange={(v) => set(ln.field, v as never)}
                  />
                  <span className="min-w-16 text-right font-mono text-sm text-ink">{centsWhole(ln.amountCents)}</span>
                </div>
              ) : null}
            </div>

            {on && ln.extra === 'mode' ? (
              <div className="mt-3 pl-8">
                <Segmented value={state.inboundMode} options={INBOUND_MODE_OPTIONS} onChange={(v) => set('inboundMode', v)} />
              </div>
            ) : null}
            {on && ln.extra === 'grade' ? (
              <div className="mt-3 pl-8">
                <Segmented value={state.palletGrade} options={GRADE_OPTIONS} onChange={(v) => set('palletGrade', v)} />
              </div>
            ) : null}
            {on && ln.extra === 'months' ? (
              <div className="mt-3 flex items-center gap-3 pl-8">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Months</span>
                <NumberStepper
                  value={state.storageMonths}
                  onDec={() => stepBy('storageMonths', -1)}
                  onInc={() => stepBy('storageMonths', 1)}
                  onChange={(v) => set('storageMonths', v)}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {fam.setup ? (
        <button
          type="button"
          onClick={() => set('setupOn', !state.setupOn)}
          className={`flex items-center gap-3.5 border p-4 text-left transition ${
            state.setupOn ? 'border-accent bg-accent-soft' : 'border-line bg-bg'
          }`}
        >
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center border text-xs ${
              state.setupOn ? 'border-accent bg-accent text-on-primary' : 'border-line'
            }`}
          >
            {state.setupOn ? '✓' : ''}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-ink">New account setup</span>
            <span className="text-xs text-ink-dim">One-time admin fee · ADM-SETUP</span>
          </span>
          <span className="ml-auto font-mono text-sm text-ink-dim">{centsWhole(microsToCents(rateMicrosOf(card, 'ADM-SETUP')))}</span>
        </button>
      ) : null}
    </div>
  );
}
