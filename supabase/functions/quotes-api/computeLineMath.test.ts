// Unit test locking the quote line math encoding + rounding contract.
//
// computeLineMath is the single source of truth for the four server-derived
// line_*_cents on a quote line. Both addLineItem (create) and patchLineItem
// (inline edit) feed it, so create/edit parity is structural: this test pins
// the exact encoding so a future refactor cannot silently change the money.
//
// Encoding under test:
//   - quantity_e3 is thousandths (1000 = 1 unit).
//   - gross   = (quantity_e3 * unit_price_cents) / 1000   (truncating BigInt).
//   - discount= (gross * discount_bps) / 10000            (truncating BigInt).
//   - net     = gross - discount.
//   - tax     = is_taxable ? (net * tax_rate_snapshot) / 10000 : 0.
//   - total   = net + tax.
// All four outputs are returned as decimal strings (BIGINT cents on the wire).
//
// Run (the import map resolves the bare "zod" specifier; --allow-net is needed
// because importing index.ts runs serveBundleWithGate -> Deno.serve at module
// load, which the test does not exercise but must be permitted to bind):
//   deno test --no-check --allow-env --allow-net --allow-read \
//     --config supabase/functions/deno.json \
//     supabase/functions/quotes-api/computeLineMath.test.ts

import { assertEquals } from 'jsr:@std/assert@1';

import { computeLineMath } from './index.ts';

Deno.test('whole units, no discount, no tax', () => {
  const m = computeLineMath({
    quantity_e3: 2000, // 2 units
    unit_price_cents: 500, // $5.00
    discount_bps: 0,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  assertEquals(m, {
    line_subtotal_cents: '1000',
    line_discount_cents: '0',
    line_tax_cents: '0',
    line_total_cents: '1000',
  });
});

Deno.test('fractional quantity_e3 truncates gross (BigInt division)', () => {
  // 1.5 units (1500 e3) at 333 cents => 1500*333/1000 = 499500/1000 = 499.5,
  // truncated to 499.
  const m = computeLineMath({
    quantity_e3: 1500,
    unit_price_cents: 333,
    discount_bps: 0,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  assertEquals(m.line_subtotal_cents, '499');
  assertEquals(m.line_total_cents, '499');
});

Deno.test('discount in bps truncates', () => {
  // gross 10000, 1500 bps (15%) => 10000*1500/10000 = 1500 discount, net 8500.
  const m = computeLineMath({
    quantity_e3: 1000,
    unit_price_cents: 10000,
    discount_bps: 1500,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  assertEquals(m, {
    line_subtotal_cents: '10000',
    line_discount_cents: '1500',
    line_tax_cents: '0',
    line_total_cents: '8500',
  });
});

Deno.test('tax applies to net (after discount) when taxable', () => {
  // gross 10000, 1000 bps discount => discount 1000, net 9000.
  // tax 825 bps (8.25%) on net => 9000*825/10000 = 7425000/10000 = 742.5 -> 742.
  const m = computeLineMath({
    quantity_e3: 1000,
    unit_price_cents: 10000,
    discount_bps: 1000,
    tax_rate_snapshot: 825,
    is_taxable: true,
  });
  assertEquals(m, {
    line_subtotal_cents: '10000',
    line_discount_cents: '1000',
    line_tax_cents: '742',
    line_total_cents: '9742',
  });
});

Deno.test('is_taxable false zeroes tax even with a tax_rate_snapshot', () => {
  const m = computeLineMath({
    quantity_e3: 1000,
    unit_price_cents: 10000,
    discount_bps: 0,
    tax_rate_snapshot: 825,
    is_taxable: false,
  });
  assertEquals(m.line_tax_cents, '0');
  assertEquals(m.line_total_cents, '10000');
});

Deno.test('string inputs round-trip identically to numbers (BigInt parse)', () => {
  const fromStrings = computeLineMath({
    quantity_e3: '1500',
    unit_price_cents: '333',
    discount_bps: 0,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  const fromNumbers = computeLineMath({
    quantity_e3: 1500,
    unit_price_cents: 333,
    discount_bps: 0,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  assertEquals(fromStrings, fromNumbers);
});

Deno.test('large values stay exact (no float overflow)', () => {
  // 1,000,000 units at $10,000.00 => 1e6 * 1_000_000 cents = 1e12 cents gross.
  const m = computeLineMath({
    quantity_e3: 1_000_000_000, // 1,000,000 units
    unit_price_cents: 1_000_000, // $10,000.00
    discount_bps: 0,
    tax_rate_snapshot: 0,
    is_taxable: false,
  });
  assertEquals(m.line_subtotal_cents, '1000000000000');
  assertEquals(m.line_total_cents, '1000000000000');
});
