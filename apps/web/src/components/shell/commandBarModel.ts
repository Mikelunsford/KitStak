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

// ---------------------------------------------------------------------------
// Unified command rows. The palette renders two kinds of result in one listbox:
// action verbs ("New quote", "Receive payment") and entity matches from
// search-api. Action verbs cannot be SearchResultItems (that schema is an
// enum-typed entity_type plus a UUID entity_id), so both kinds collapse into a
// lightweight CommandRow for rendering and keyboard navigation. Selecting any
// row just navigates to its href.
// ---------------------------------------------------------------------------

export interface CommandRow {
  /** Stable React key, unique across the whole flattened list. */
  key: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface CommandRowGroup {
  /** Group key: 'action' for verbs, otherwise the SearchResultGroup. */
  key: 'action' | SearchResultGroup;
  label: string;
  rows: CommandRow[];
}

/** Convert one entity search item into a command row. */
function entityRow(item: SearchResultItem): CommandRow {
  return {
    key: `${item.entity_type}-${item.entity_id}`,
    title: item.title,
    subtitle: item.subtitle,
    href: item.href,
  };
}

/**
 * Build the full grouped row model the palette renders: an Actions group first
 * (when any verb matched), then the entity groups in GROUP_ORDER. Keeping the
 * verbs ahead of entity matches puts the executable shortcuts at the top of the
 * list where Enter lands by default.
 */
export function buildCommandGroups(
  actionRows: ReadonlyArray<CommandRow>,
  result: SearchResult | undefined,
): CommandRowGroup[] {
  const out: CommandRowGroup[] = [];
  if (actionRows.length > 0) {
    out.push({ key: 'action', label: 'Actions', rows: [...actionRows] });
  }
  for (const g of orderedGroups(result)) {
    out.push({ key: g.group, label: g.label, rows: g.items.map(entityRow) });
  }
  return out;
}

/**
 * Flatten the grouped rows into a single list in display order. The flat index
 * is what arrow-key navigation moves over; each row keeps its href so Enter can
 * navigate directly to the active row.
 */
export function flattenRows(
  groups: ReadonlyArray<CommandRowGroup>,
): CommandRow[] {
  const flat: CommandRow[] = [];
  for (const g of groups) {
    for (const row of g.rows) flat.push(row);
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
