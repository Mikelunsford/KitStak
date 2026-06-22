// Pure formatting helpers for the Section Dashboards (Phase 1). Kept out of the
// React tree so the label and bucket logic is unit-testable under Vitest
// without a DOM renderer (the repo's no-jsdom convention; mirrors
// dashboardWorkCards.ts).

import type { MoneySummary } from '@/lib/types/cross_cutting';

/** Human labels for the opportunity pipeline stages. */
export const OPPORTUNITY_STAGE_LABELS: Readonly<Record<string, string>> = {
  discovery: 'Discovery',
  evaluation: 'Evaluation',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Closed won',
  closed_lost: 'Closed lost',
};

/** Title-case a snake_case token: `revise_requested` -> `Revise requested`. */
export function humanizeToken(token: string): string {
  if (!token) return '';
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Display label for an opportunity stage, falling back to a humanized token. */
export function stageLabel(stage: string): string {
  return OPPORTUNITY_STAGE_LABELS[stage] ?? humanizeToken(stage);
}

/** A wire cents value (string to survive 2^53, or a number) as a Number. */
export function centsToNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

export interface AgingRow {
  key: string;
  label: string;
  cents: number;
}

/**
 * Project the AR aging object into ordered rows for rendering. Current first,
 * then the increasingly overdue buckets. Amounts are returned as Numbers so the
 * caller can hand them straight to formatCents.
 */
export function arAgingRows(aging: MoneySummary['ar_aging']): AgingRow[] {
  return [
    { key: 'current', label: 'Current', cents: centsToNumber(aging.current_cents) },
    { key: 'd1_30', label: '1 to 30 days', cents: centsToNumber(aging.d1_30_cents) },
    { key: 'd31_60', label: '31 to 60 days', cents: centsToNumber(aging.d31_60_cents) },
    { key: 'd61_90', label: '61 to 90 days', cents: centsToNumber(aging.d61_90_cents) },
    {
      key: 'd90_plus',
      label: 'Over 90 days',
      cents: centsToNumber(aging.d90_plus_cents),
    },
  ];
}

/** Win rate as a one-decimal percentage string. */
export function winRateDisplay(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
