// Wave 12 / A3 (3PL quote integration). Pure mapping from Job Builder template
// lines to quote line-add requests. Extracted as a pure function (like the
// quote line applyItemSelection helper) so the vitest unit test can pin the
// contract without rendering a page or loading the supabase singleton.
//
// Mapping:
//   component         -> quote line kind 'item' (carries item_id + rate_cents)
//   service           -> quote line kind 'vas'  (carries vas_id  + rate_cents)
//   step with a rate  -> quote line kind 'item' with no item_id, i.e. a
//                        free-text priced line (the same shape the add-line form
//                        produces for a manual priced line), so the labor rate
//                        carries onto the quote total
//   step with no rate -> quote line kind 'note', a display-only instruction line
//
// quantity (numeric) becomes quantity_e3 (thousandths); rate_cents becomes
// unit_price_cents. The server re-validates and prices every line on the way in,
// so this stays a pure field map with no money authority.

import type { JobTemplateLine } from '@/lib/types/threepl';
import type { CreateQuoteLineRequest, QuoteLineKind } from '@/lib/types/sales';

// A step carries no catalog item or VAS. A priced step still needs to land on
// the quote total, so it becomes a free-text priced 'item' line; an unpriced
// step is an instruction and becomes a display-only 'note'.
function quoteLineKindFor(line: JobTemplateLine): QuoteLineKind {
  switch (line.line_kind) {
    case 'component':
      return 'item';
    case 'service':
      return 'vas';
    default:
      return line.rate_cents != null ? 'item' : 'note';
  }
}

/**
 * Map one job_template_line to a quote line-add request at the given position.
 */
export function jobTemplateLineToQuoteLine(
  line: JobTemplateLine,
  position: number,
): CreateQuoteLineRequest {
  const kind = quoteLineKindFor(line);
  const qty = line.quantity == null ? 1 : Number(line.quantity);
  const quantity_e3 = Number.isFinite(qty) ? Math.round(qty * 1000) : 1000;
  // Only a note is unpriced; component, service, and priced steps all carry
  // their rate onto the quote.
  const unit_price_cents = kind === 'note' ? 0 : line.rate_cents ?? 0;
  return {
    position,
    item_id: line.line_kind === 'component' ? line.item_id : null,
    vas_id: line.line_kind === 'service' ? line.vas_id : null,
    name: line.name,
    description: null,
    kind,
    quantity_e3,
    unit_price_cents,
    // Template lines carry no discount or tax; the server snapshots tax only
    // when a tax_id is supplied (none here), so these match the manual add-line
    // defaults and keep every line untaxed until the operator edits it.
    discount_bps: 0,
    is_taxable: true,
    // ADR 0005 Phase 1a: template lines default to one_time.
    billing_interval: 'one_time',
  };
}

/**
 * Map a whole template's lines to quote line-add requests, sorted by the
 * template's own line order and appended after basePosition (the next free
 * position on the target quote).
 */
export function buildQuoteLinesFromTemplate(
  lines: JobTemplateLine[],
  basePosition: number,
): CreateQuoteLineRequest[] {
  return [...lines]
    .sort((a, b) => a.position - b.position)
    .map((line, i) => jobTemplateLineToQuoteLine(line, basePosition + i));
}
