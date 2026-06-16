// Pure model helpers for the Cmd/Ctrl-K command bar. No React, no hooks, no
// DOM. Kept separate from CommandBar.tsx so the load-bearing keyboard and
// flattening logic is unit-testable without a renderer (the repo runs Vitest
// without jsdom).

import type {
  SearchResult,
  SearchResultGroup,
  SearchResultItem,
} from '@/lib/types/cross_cutting';

// Display order for the result groups. The command bar renders groups in this
// order and the flat navigation list follows it, so arrow-key traversal moves
// top to bottom exactly as the operator sees the list. Groups absent from a
// given result set are simply skipped.
export const GROUP_ORDER: readonly SearchResultGroup[] = [
  'customer',
  'quote',
  'invoice',
  'project',
  'item',
  'job_run',
] as const;

// Human label per group, shown as the section heading and the per-row tag.
export const GROUP_LABEL: Record<SearchResultGroup, string> = {
  customer: 'Customers',
  quote: 'Quotes',
  invoice: 'Invoices',
  project: 'Projects',
  item: 'Items',
  job_run: 'Job runs',
};

export interface CommandBarGroup {
  group: SearchResultGroup;
  label: string;
  items: SearchResultItem[];
}

/**
 * Order the populated groups for rendering. Empty or absent groups drop out.
 */
export function orderedGroups(result: SearchResult | undefined): CommandBarGroup[] {
  if (!result) return [];
  const out: CommandBarGroup[] = [];
  for (const group of GROUP_ORDER) {
    const items = result.groups[group];
    if (items && items.length > 0) {
      out.push({ group, label: GROUP_LABEL[group], items });
    }
  }
  return out;
}

/**
 * Flatten the ordered groups into a single list in display order. The flat
 * index is what arrow-key navigation moves over; each entry keeps the href so
 * Enter can navigate directly to the active row.
 */
export function flattenResults(result: SearchResult | undefined): SearchResultItem[] {
  const flat: SearchResultItem[] = [];
  for (const g of orderedGroups(result)) {
    for (const item of g.items) flat.push(item);
  }
  return flat;
}

/**
 * Move the active index by `delta` over a list of `count` rows, wrapping at
 * both ends. With no rows the active index stays at -1 (nothing selectable).
 * Wrapping keeps ArrowDown on the last row landing back on the first, which is
 * the expected command-palette behaviour.
 */
export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  // Normalise current into range first so a stale index from a prior, longer
  // result set cannot push the result out of bounds.
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  const next = (base + delta + count) % count;
  return next;
}
