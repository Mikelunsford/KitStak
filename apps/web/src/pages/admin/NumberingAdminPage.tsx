import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';
import {
  useNumberingSequences,
  useResetNumbering,
} from '@/lib/hooks/useSettings';

/**
 * Numbering sequence admin page.
 *
 * Read-only listing of every per-doc-type seed row with a reset action.
 * Reset is audit-relevant (the operator records a new starting value);
 * the back end RPC clears last_reset_period so the next allocation
 * re-evaluates the reset window.
 */
export function NumberingAdminPage() {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const query = useNumberingSequences({ enabled });
  const reset = useResetNumbering();

  const [pending, setPending] = useState<string | null>(null);

  function handleReset(docType: string) {
    setPending(docType);
    reset.mutate(
      { doc_type: docType, next_value: 1 },
      {
        onSettled: () => setPending(null),
      },
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Document numbering</h1>
        <p className="font-sans text-sm text-ink-dim">
          Per-document-type sequence seeds. Allocation is gap-free under
          load via an advisory lock. Reset restarts the counter at 1.
        </p>
      </header>

      {query.isLoading ? (
        <p className="text-ink-dim">Loading.</p>
      ) : query.isError ? (
        <p className="text-danger">Failed to load sequences.</p>
      ) : (
        <table className="w-full border border-line">
          <thead>
            <tr className="bg-bg-2 text-left">
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                Doc type
              </th>
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                Prefix
              </th>
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                Reset
              </th>
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                Next value
              </th>
              <th className="px-4 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={row.doc_type} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-sm text-ink">
                  {row.doc_type}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-ink-dim">
                  {row.prefix || '(none)'}
                </td>
                <td className="px-4 py-3 font-sans text-sm text-ink-dim">
                  {row.reset_period}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-ink">
                  {row.next_value}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="secondary"
                    onClick={() => handleReset(row.doc_type)}
                    disabled={pending === row.doc_type}
                  >
                    {pending === row.doc_type ? 'Resetting.' : 'Reset to 1'}
                  </Button>
                </td>
              </tr>
            ))}
            {(query.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-dim">
                  No sequences seeded. First allocation will create the row.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
