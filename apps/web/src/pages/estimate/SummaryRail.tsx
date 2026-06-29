import { ENGINE_LABELS, FAMILIES } from '@/lib/estimate/families';
import type { EstimateResult } from '@/lib/estimate/engine';

import { CHANNEL_LABELS, FORM_LABELS, MATERIALS_LABELS } from './options';
import { centsWhole, microsDisplay, shortDate } from './format';
import { parseField, type EngineState } from './engineState';

interface Row {
  label: string;
  value: string;
}

// The sticky rail beside the wizard - a running picture of the scope being
// built. Groups reveal as the user advances through the steps.
export function SummaryRail({ state, result }: { state: EngineState; result: EstimateResult }) {
  const fam = FAMILIES[state.family] ?? FAMILIES.display;
  const qty = parseField(state.qty);
  const rawSec = parseField(state.studyMin) * 60 + parseField(state.studySec);

  const classification: Row[] = [
    { label: 'Project', value: state.projectName || '-' },
    { label: 'Customer', value: state.customerId ? 'Selected' : 'Not selected' },
    { label: 'Family', value: fam.label },
    { label: 'Channel', value: CHANNEL_LABELS[state.channel] ?? '-' },
    { label: 'Form', value: FORM_LABELS[state.form] ?? '-' },
    { label: 'Pricing', value: ENGINE_LABELS[state.engine] },
    { label: 'Targeted ship', value: shortDate(state.goLive) },
    { label: 'Materials', value: MATERIALS_LABELS[state.materials] },
  ];

  const pricing: Row[] = [{ label: state.engine === 'flat' ? 'Accounts' : 'Qty', value: qty.toLocaleString() }];
  if (state.engine === 'timestudy') {
    pricing.push({ label: 'Time / unit', value: `${Math.floor(rawSec / 60)}m ${Math.round(rawSec % 60)}s` });
    pricing.push({ label: 'Inflate / markup', value: `${parseField(state.inflationPct)}% · ${parseField(state.markup)}x` });
  } else if (state.engine === 'touch') {
    pricing.push({ label: 'Touches / unit', value: String(parseField(state.touches)) });
  } else if (state.engine === 'perpiece') {
    pricing.push({ label: 'Base rate', value: microsDisplay(result.sellPerUnitMicros) });
  }
  if (result.hasProduction) pricing.push({ label: 'Sell / unit', value: microsDisplay(result.sellPerUnitMicros) });

  const lineItems: Row[] = result.passThroughItems.map((it) => ({ label: it.label, value: centsWhole(it.amountCents) }));
  if (lineItems.length === 0) lineItems.push({ label: 'Line items', value: 'None yet' });

  const currentGroup = state.step >= 4 ? 3 : state.step;
  const groups = [
    { title: 'Classification', step: 1, rows: classification },
    { title: 'Pricing', step: 2, rows: pricing },
    { title: 'Line items', step: 3, rows: lineItems },
  ].filter((g) => g.step <= currentGroup);

  return (
    <div className="sticky top-6 flex flex-col gap-4 border border-line bg-bg-2 p-6">
      <span className="font-mono text-xs uppercase tracking-widest text-ink-faint">Job description</span>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col">
          <span className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">{g.title}</span>
          {g.rows.map((row, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 border-t border-line py-2">
              <span className="text-xs uppercase tracking-wide text-ink-faint">{row.label}</span>
              <span className="text-right font-mono text-sm text-ink-dim">{row.value}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="text-xs leading-relaxed text-ink-faint">
        Live summary of the scope you are building. The full estimate appears on the final step.
      </p>
    </div>
  );
}
