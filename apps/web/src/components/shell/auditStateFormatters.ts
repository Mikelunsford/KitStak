// BNEW-7: per-entity-type state label formatter registry for the
// AuditTimeline display layer.
//
// Why this exists: the DB enum for a quote keeps the value `submitted`
// (forward-only migrations from PR #103 / B7), but the UI button reads
// "Send for approval" and the operator expects history rows to mirror
// that vocabulary. AuditTimeline used to render `from_state` and
// `to_state` raw; we route through this registry so each entity type
// can map its enum values to operator-facing copy without touching
// the DB.
//
// Display-only. The DB enum is unchanged. Adding a new entity type
// here is purely additive: omit it and the passthrough Title-Caser
// applies (underscores -> spaces, first letter capitalised).
//
// Constitutional posture:
//   - SPA only, no schema or RLS surface change.
//   - No new top-level dependency.
//   - Branding: no em dashes / double-hyphens / emojis in labels.

import { formatQuoteStateLabel } from '@/pages/3pl-operations/quotes/formatQuoteStateLabel';

export type StateLabelFormatter = (state: string) => string;

/**
 * Default formatter: underscores -> spaces, first letter capitalised per
 * word. Mirrors the cosmetic touch-up used in formatQuoteStateLabel.
 */
export function defaultStateLabel(state: string): string {
  return state
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

const STATE_FORMATTERS: Record<string, StateLabelFormatter> = {
  quote: formatQuoteStateLabel,
};

/**
 * Resolve a (entity_type, state) pair to operator-facing copy. Unknown
 * entity types pass through the Title-Case formatter so the timeline
 * stays readable even for entities that haven't onboarded a custom
 * formatter yet.
 */
export function formatStateLabel(entityType: string, state: string): string {
  const fn = STATE_FORMATTERS[entityType] ?? defaultStateLabel;
  return fn(state);
}
