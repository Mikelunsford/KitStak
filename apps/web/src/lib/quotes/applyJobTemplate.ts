// Wave 12 / A3 (3PL quote integration). Pure mapping from Job Builder template
// lines to quote line-add requests. Extracted as a pure function (like the
// quote line applyItemSelection helper) so the vitest unit test can pin the
// contract without rendering a page or loading the supabase singleton.
//
// Mapping:
//   component -> quote line kind 'item' (carries item_id + rate_cents)
//   service   -> quote line kind 'vas'  (carries vas_id  + rate_cents)
//   step      -> quote line kind 'note' (unpriced)
//
// A quote line is only priced when it anchors to a catalog item or a VAS, so a
// priced step has no home as a priced quote line. Rather than silently drop the
// rate, a step lands as an unpriced note with its rate preserved in the
// description. quantity (numeric) becomes quantity_e3 (thousandths); rate_cents
// becomes unit_price_cents. The server re-validates and prices every line on
// the way in, so this stays a pure field map with no money authority.

import type { JobTemplateLine } from '@/lib/types/threepl';
import type { CreateQuoteLineRequest, QuoteLineKind } from '@/lib/types/sales';
import { formatCents } from '@/lib/money';

const KIND_BY_LINE: Record<JobTemplateLine['line_kind'], QuoteLineKind> = {
  component: 'item',
  service: 'vas',
  step: 'note',
};

// Preserve a priced step's labor rate in the note description so it is visible
// on the quote even though the note line itself carries no price.
function stepRateNote(line: JobTemplateLine): string | null {
  if (line.line_kind !== 'step' || line.rate_cents == null) return null;
  const rate = formatCents(line.rate_cents, line.currency_code ?? 'USD');
  return line.rate_uom ? `Rate: ${rate} ${line.rate_uom}` : `Rate: ${rate}`;
}

/**
 * Map one job_template_line to a quote line-add request at the given position.
 */
export function jobTemplateLineToQuoteLine(
  line: JobTemplateLine,
  position: number,
): CreateQuoteLineRequest {
  const kind = KIND_BY_LINE[line.line_kind];
  const qty = line.quantity == null ? 1 : Number(line.quantity);
  const quantity_e3 = Number.isFinite(qty) ? Math.round(qty * 1000) : 1000;
  const priced = line.line_kind !== 'step';
  const unit_price_cents = priced && line.rate_cents != null ? line.rate_cents : 0;
  return {
    position,
    item_id: line.line_kind === 'component' ? line.item_id : null,
    vas_id: line.line_kind === 'service' ? line.vas_id : null,
    name: line.name,
    description: stepRateNote(line),
    kind,
    quantity_e3,
    unit_price_cents,
    // Template lines carry no discount or tax; the server snapshots tax only
    // when a tax_id is supplied (none here), so these match the manual add-line
    // defaults and keep every line untaxed until the operator edits it.
    discount_bps: 0,
    is_taxable: true,
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
