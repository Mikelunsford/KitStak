// ImportHistoryPage. v1 is informational; imports are sync-only with no
// job ledger to enumerate. Wave 3 will land async imports + a history table.

export function ImportHistoryPage() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-4">
      <h1 className="font-display text-3xl tracking-wide text-ink">
        IMPORT HISTORY
      </h1>
      <p className="text-sm text-ink-dim">
        Imports are synchronous in this build. There is no job history yet.
        Async imports and a job ledger will arrive in a later wave.
      </p>
    </section>
  );
}
