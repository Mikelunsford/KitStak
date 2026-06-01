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

/**
 * Operator-facing copy for the audit_log `action` column. The DB stores
 * machine verbs (`status_change`, `insert`, `invited`) that the timeline
 * used to render raw. Known verbs map to plain copy; anything else falls
 * through the Title-Case formatter (underscores -> spaces, capitalised) so
 * a new action verb stays readable without a code change. Display-only; the
 * DB value is unchanged.
 */
const ACTION_LABELS: Record<string, string> = {
  status_change: 'Status change',
  insert: 'Created',
  created: 'Created',
  create: 'Created',
  update: 'Updated',
  updated: 'Updated',
  delete: 'Deleted',
  deleted: 'Deleted',
  invited: 'Invited',
};

export function formatAuditAction(action: string | null | undefined): string {
  if (!action) return 'Change';
  return ACTION_LABELS[action] ?? defaultStateLabel(action);
}
