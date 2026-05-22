// BNEW-8: render-state classifier for EntityLabel.
//
// Pulled out into its own module so the registry behavior is testable
// without transitively importing the SPA's supabase singleton (the list
// hooks consumed by EntityLabel pull in `@/lib/supabase`, which throws
// at import time when env vars are absent — i.e. in the vitest unit
// environment).
//
// The three states are:
//   - 'pending': list query hasn't settled yet (data is undefined).
//                Callers should render a short-prefix placeholder so
//                the operator never sees a raw UUID flash on first
//                paint (the BNEW-8 symptom).
//   - 'found':   the matching row is present in the list. Render the
//                formatted display label.
//   - 'missing': the list settled but the row is absent (deleted
//                parent, cross-tenant filter, etc.). Render the raw id
//                so the field stays diagnosable in production.

export type EntityLabelState = 'pending' | 'found' | 'missing';

export function classifyEntityLabel<T extends { id: string }>(
  data: ReadonlyArray<T> | undefined,
  id: string,
): EntityLabelState {
  if (data === undefined) return 'pending';
  return data.some((row) => row.id === id) ? 'found' : 'missing';
}
