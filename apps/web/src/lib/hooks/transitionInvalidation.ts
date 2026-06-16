// R-W13-UX-01: pure cache-key helper that names the query keys a
// state-transition mutation must mark stale so the detail page (StateStepper,
// action buttons, totals) and the list update without a manual reload.
//
// Pulled into its own file so the regression test can import it without
// transitively loading the entity services (which pull `@/lib/apiClient`,
// which pulls the SPA supabase singleton; that singleton throws at import time
// when VITE_ env vars are absent, which is exactly the vitest unit case). The
// transition hooks (useTransitionInvoice, useTransitionReceivingOrder,
// useTransitionWmsPutaway, useQuoteAction, ...) invalidate the same keys inline;
// this helper locks the contract that the detail key, the entity tree, and the
// audit timeline are all swept.
//
// Each returned key is invalidated with the TanStack default (exact: false), so
// the entity-tree key (`all`) also matches the detail key by prefix. The detail
// key is still listed explicitly because a future split of the detail subtree
// (for example a `detail(id)/line-items` child key) must keep firing the
// stepper refresh that this finding closes.

import { auditLogKeys } from '@/lib/queryKeys/auditLog';

export interface EntityKeyFactory {
  readonly all: ReadonlyArray<unknown>;
  readonly detail: (id: string) => ReadonlyArray<unknown>;
}

export function transitionInvalidationKeys(
  keys: EntityKeyFactory,
  auditEntityType: string,
  id: string,
): ReadonlyArray<ReadonlyArray<unknown>> {
  return [
    keys.detail(id),
    keys.all,
    auditLogKeys.byEntity(auditEntityType, id),
  ];
}
