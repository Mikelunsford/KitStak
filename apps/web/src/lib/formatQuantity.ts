// P1-5: render a stored quantity without trailing-zero noise. Quote lines store
// quantity_e3 (thousandths) and rendered 25.000; project lines store a decimal
// quantity and rendered 25.00. This shared helper trims trailing zeros so both
// read 25, 25.5, or 25.125. Presentational and SPA-only (quantity is not money,
// so there is no _shared mirror counterpart).
//
// The caller passes the quantity already in display units (for quote lines that
// is quantity_e3 / 1000). maxDecimals caps the precision before trimming; the
// default 3 covers the quote thousandths grain and still trims a 2-decimal
// project quantity cleanly.
export function formatQuantity(qty: number, maxDecimals = 3): string {
  if (!Number.isFinite(qty)) return '0';
  const fixed = qty.toFixed(maxDecimals);
  // Drop trailing zeros, then a now-bare trailing decimal point.
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}
