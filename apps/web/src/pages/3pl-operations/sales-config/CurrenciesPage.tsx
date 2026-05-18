import { useCurrenciesList } from '@/lib/hooks/useCurrencies';

export function CurrenciesPage() {
  const { data, isLoading } = useCurrenciesList();
  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">CURRENCIES</h1>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {data && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.map((c) => (
            <li
              key={c.code}
              className="bg-bg-2 border border-line px-4 py-3 flex justify-between items-center"
            >
              <span className="font-mono text-sm">{c.code}</span>
              <span className="text-ink-dim text-sm">{c.name}</span>
              <span className="text-ink-dim text-xs">
                {c.is_zero_decimal ? 'zero-decimal' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
