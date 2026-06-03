// PeriodClosePage. Finance admin workflow. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (with the year selector in the actions slot)
// + StatusBadge + kit Button replace the hand-rolled header, raw status text,
// and raw close/reopen buttons. The 12-month fiscal table stays hand-rolled (a
// workflow table with per-row actions, not an entity list). The fill-12-months
// logic, the close/reopen mutations, and the admin gating are preserved.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useClosePeriod,
  usePeriodClose,
  useReopenPeriod,
} from '@/lib/hooks/usePeriodClose';

/**
 * PeriodClosePage. Per-period state with close / reopen buttons. Admin /
 * accounting only; the SPA hides buttons and the server enforces requireCap.
 */
export function PeriodClosePage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading, error } = usePeriodClose({ year });
  const close = useClosePeriod();
  const reopen = useReopenPeriod();

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Get paid / Period close"
        title="Period close"
        actions={
          <label className="flex items-center gap-2 text-sm font-sans text-ink-dim">
            Year
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
              className="bg-bg-2 border border-line px-2 py-1 text-ink font-mono w-24"
            />
          </label>
        }
      />

      {isLoading ? (
        <p className="text-ink-dim">Loading periods.</p>
      ) : error ? (
        <p className="text-accent font-sans">{(error as Error).message}</p>
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Period</th>
              <th className="py-2">Status</th>
              <th className="py-2">Closed at</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
              const row = (data ?? []).find(
                (p) => p.period_year === year && p.period_month === month,
              );
              const status = row?.status ?? 'open';
              return (
                <tr key={month} className="border-b border-line">
                  <td className="py-2 font-mono">
                    {year}-{String(month).padStart(2, '0')}
                  </td>
                  <td className="py-2">
                    <StatusBadge status={status} />
                  </td>
                  <td className="py-2 text-ink-dim">{row?.closed_at ?? '-'}</td>
                  <td className="py-2 text-right">
                    {status === 'closed' ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          reopen.mutate({
                            period_year: year,
                            period_month: month,
                          })
                        }
                        disabled={reopen.isPending}
                      >
                        Reopen
                      </Button>
                    ) : (
                      <Button
                        onClick={() =>
                          close.mutate({
                            period_year: year,
                            period_month: month,
                          })
                        }
                        disabled={close.isPending}
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(close.error || reopen.error) && (
        <p className="text-accent font-sans text-sm">
          {(close.error || reopen.error) instanceof Error
            ? (close.error || reopen.error)!.message
            : 'Period operation failed.'}
        </p>
      )}
    </section>
  );
}
