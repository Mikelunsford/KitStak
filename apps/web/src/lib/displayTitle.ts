/**
 * displayTitle. The single source for an entity's human-facing title and its
 * system number, used by detail-page headers and list rows.
 *
 * Workstream A of the 2026-06-17 UI scan (titles, headers, list indexing).
 * The scan found titles were number-first for transactional entities (a quote
 * read "Q-2026-00008" with the job name in small text beneath). This resolver
 * leads with the human name and demotes the number to a chip beside the status.
 *
 * Pure and synchronous. It takes an already-loaded record plus any related
 * labels the caller has already resolved (the customer or project name it
 * loads for links and the breadcrumb). It never fetches. Nameless entities
 * (invoice, payment, sales order, fulfillment, receiving, shipment, runs)
 * derive a title from those relations, falling back to the number, then to a
 * short id prefix via fallbackLabel so the field stays diagnosable.
 *
 * SPA-only: no canon or contract counterpart (the byte-identical types mirrors
 * are untouched). This module stays free of React and money-format imports so
 * it remains trivially testable and tree-shakeable.
 */
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';

export type TitleKind =
  | 'quote'
  | 'project'
  | 'customer'
  | 'item'
  | 'vendor'
  | 'member'
  | 'lead'
  | 'opportunity'
  | 'invoice'
  | 'payment'
  | 'credit_note'
  | 'sales_order'
  | 'fulfillment'
  | 'receiving'
  | 'shipment'
  | 'manufacturing_run'
  | 'kitting_job'
  | 'job_run'
  | 'work_assignment';

/**
 * The subset of entity fields the resolver reads. Permissive by design so a
 * caller can pass any loaded record (Quote, Invoice, Customer, ...) without a
 * per-kind cast. Unknown fields are ignored.
 */
export interface TitleRecord {
  id?: string | null;
  // human-name candidates
  title?: string | null;
  name?: string | null;
  display_name?: string | null;
  sku?: string | null;
  // system-number candidates
  number?: string | null;
  invoice_number?: string | null;
  payment_number?: string | null;
  credit_note_number?: string | null;
  order_number?: string | null;
  fulfillment_number?: string | null;
  receiving_number?: string | null;
  shipment_number?: string | null;
  run_number?: string | null;
  job_number?: string | null;
  member_number?: string | null;
  vendor_number?: string | null;
}

/** Related labels the caller has already resolved. The resolver never fetches. */
export interface TitleRelations {
  customerName?: string | null;
  projectName?: string | null;
  vendorName?: string | null;
  itemName?: string | null;
  templateName?: string | null;
  salesOrderNumber?: string | null;
  channelName?: string | null;
}

export interface ResolvedTitle {
  /** The human-facing H1. Falls back to the number, then a short id prefix. */
  title: string;
  /** The system number for the chip beside the status. Null when none. */
  number: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

/**
 * Render the "code · name" label used for an entity reference (e.g.
 * "SKU-1 · Widget"). Shared with EntityLabel so both surfaces agree on the
 * format. When no code is present the name stands alone.
 */
export function formatCodeName(
  code: string | null | undefined,
  displayName: string,
): string {
  const cleaned = clean(code);
  return cleaned ? `${cleaned} · ${displayName}` : displayName;
}

/**
 * Resolve the human title and system number for an entity record.
 *
 * @param kind The entity kind, which selects the title and number rules.
 * @param record The loaded entity row (only the fields it carries are read).
 * @param relations Labels the caller already resolved (customer name, etc.).
 */
export function displayTitle(
  kind: TitleKind,
  record: TitleRecord,
  relations: TitleRelations = {},
): ResolvedTitle {
  const id = record.id ?? null;
  const idPrefix = fallbackLabel(null, id);

  switch (kind) {
    case 'quote': {
      const number = clean(record.number);
      return { title: firstNonEmpty(record.title, number, idPrefix) ?? '', number };
    }
    case 'project': {
      const number = clean(record.number);
      return { title: firstNonEmpty(record.name, number, idPrefix) ?? '', number };
    }
    case 'customer':
    case 'lead':
    case 'opportunity':
      return {
        title: firstNonEmpty(record.display_name, record.name, idPrefix) ?? '',
        number: null,
      };
    case 'item': {
      const sku = clean(record.sku);
      return { title: firstNonEmpty(record.name, sku, idPrefix) ?? '', number: sku };
    }
    case 'vendor': {
      const number = clean(record.vendor_number);
      return {
        title: firstNonEmpty(record.display_name, record.name, number, idPrefix) ?? '',
        number,
      };
    }
    case 'member': {
      const number = clean(record.member_number);
      return {
        title: firstNonEmpty(record.display_name, record.name, number, idPrefix) ?? '',
        number,
      };
    }
    case 'invoice': {
      const number = clean(record.invoice_number);
      const derived = firstNonEmpty(relations.customerName, relations.projectName);
      return { title: firstNonEmpty(derived, number, idPrefix) ?? '', number };
    }
    case 'payment': {
      const number = clean(record.payment_number);
      return { title: firstNonEmpty(relations.customerName, number, idPrefix) ?? '', number };
    }
    case 'credit_note': {
      const number = clean(record.credit_note_number);
      return { title: firstNonEmpty(relations.customerName, number, idPrefix) ?? '', number };
    }
    case 'sales_order': {
      const number = clean(record.order_number);
      return {
        title: firstNonEmpty(relations.customerName, relations.channelName, number, idPrefix) ?? '',
        number,
      };
    }
    case 'fulfillment': {
      const number = clean(record.fulfillment_number);
      const derived = relations.salesOrderNumber
        ? `Fulfillment for ${relations.salesOrderNumber}`
        : null;
      return { title: firstNonEmpty(derived, number, idPrefix) ?? '', number };
    }
    case 'receiving': {
      const number = clean(record.receiving_number);
      return { title: firstNonEmpty(relations.vendorName, number, idPrefix) ?? '', number };
    }
    case 'shipment': {
      const number = clean(record.shipment_number);
      return { title: firstNonEmpty(relations.customerName, number, idPrefix) ?? '', number };
    }
    case 'manufacturing_run':
    case 'job_run': {
      const number = clean(record.run_number);
      return {
        title: firstNonEmpty(relations.itemName, relations.templateName, number, idPrefix) ?? '',
        number,
      };
    }
    case 'kitting_job': {
      const number = clean(record.job_number);
      return { title: firstNonEmpty(relations.itemName, number, idPrefix) ?? '', number };
    }
    case 'work_assignment': {
      const number = clean(record.number);
      return { title: firstNonEmpty(record.title, number, idPrefix) ?? '', number };
    }
  }

  // Exhaustive over TitleKind. The never-assignment fails the build if a new
  // kind is added without a case; the return keeps the function total.
  const exhaustive: never = kind;
  void exhaustive;
  return { title: idPrefix, number: null };
}
