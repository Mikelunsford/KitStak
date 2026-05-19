export const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'ISK',
]);

export function roundHalfEven(n: number): number {
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function formatCents(cents: number | string, currency = 'USD'): string {
  const asNumber = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(asNumber)) throw new Error('Invalid cents value');

  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const value = isZeroDecimal ? asNumber : asNumber / 100;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: isZeroDecimal ? 0 : 2,
    maximumFractionDigits: isZeroDecimal ? 0 : 2,
  }).format(value);
}
