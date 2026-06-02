import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useChartOfAccounts } from '@/lib/hooks/useChartOfAccounts';
import { useCreateJournalEntry } from '@/lib/hooks/useJournalEntries';
import { formatCents } from '@/lib/money';
import type { JournalEntryLineInput } from '@/lib/services/journalEntriesService';

/**
 * JournalEntryCreatePage. Closes G-JE-FORM-01. Operator drafts a manual JE
 * by selecting accounts from the chart of accounts and entering paired
 * debits/credits. The form enforces sum(debit) == sum(credit) and both > 0
 * before allowing submit; the server check_journal_balance trigger is the
 * authoritative gate but the client-side mirror keeps the operator out of
 * the round-trip-and-bounce loop.
 */

interface DraftLine {
  /** Stable client-side key so React reconciles rows by identity, not index. */
  id: string;
  account_id: string;
  debit_cents: string;
  credit_cents: string;
  memo: string;
}

function emptyLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    account_id: '',
    debit_cents: '0',
    credit_cents: '0',
    memo: '',
  };
}

export function JournalEntryCreatePage() {
  const navigate = useNavigate();
  const accounts = useChartOfAccounts();
  const create = useCreateJournalEntry();

  const today = new Date().toISOString().slice(0, 10);
  const [entryNumber, setEntryNumber] = useState('');
  const [entryDate, setEntryDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const { totalDebit, totalCredit, balanced } = useMemo(() => {
    const td = lines.reduce((acc, l) => acc + (Number(l.debit_cents) || 0), 0);
    const tc = lines.reduce((acc, l) => acc + (Number(l.credit_cents) || 0), 0);
    return {
      totalDebit: td,
      totalCredit: tc,
      balanced: td > 0 && td === tc,
    };
  }, [lines]);

  function setLineField<K extends keyof DraftLine>(
    index: number,
    key: K,
    value: DraftLine[K],
  ) {
    setLines((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = { ...current, [key]: value };
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!balanced) return;
    const [year, month] = entryDate.split('-').map(Number);
    if (!year || !month) return;

    const lineInputs: JournalEntryLineInput[] = lines
      .filter((l) => l.account_id && (Number(l.debit_cents) > 0 || Number(l.credit_cents) > 0))
      .map((l, i) => {
        const input: JournalEntryLineInput = {
          account_id: l.account_id,
          debit_cents: l.debit_cents || '0',
          credit_cents: l.credit_cents || '0',
          sort_order: i,
        };
        if (l.memo) input.memo = l.memo;
        return input;
      });

    const body = {
      entry_number: entryNumber,
      entry_date: entryDate,
      period_year: year,
      period_month: month,
      source_type: 'manual' as const,
      lines: lineInputs,
      ...(memo ? { memo } : {}),
    };

    const created = await create.mutateAsync(body);
    navigate(`/finance/journal-entries/${created.id}`);
  }

  const accountItems = accounts.data ?? [];

  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW JOURNAL ENTRY
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextInput
            label="Entry number"
            value={entryNumber}
            onChange={(e) => setEntryNumber(e.target.value)}
            required
          />
          <TextInput
            label="Entry date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Memo
          </span>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        <section className="flex flex-col gap-3">
          <header className="flex items-center justify-between">
            <h2 className="text-2xl font-display tracking-wide text-ink">LINES</h2>
            <button
              type="button"
              onClick={addLine}
              className="px-3 py-1 border border-line text-ink text-xs font-display tracking-wider"
            >
              + ADD LINE
            </button>
          </header>

          <table className="w-full text-sm font-sans border-collapse">
            <thead>
              <tr className="text-left text-ink-dim border-b border-line">
                <th className="py-2">Account</th>
                <th className="py-2 text-right">Debit (cents)</th>
                <th className="py-2 text-right">Credit (cents)</th>
                <th className="py-2">Memo</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.id} className="border-b border-line">
                  <td className="py-2 pr-2">
                    <select
                      value={line.account_id}
                      onChange={(e) => setLineField(i, 'account_id', e.target.value)}
                      disabled={accounts.isLoading}
                      className="w-full bg-bg-2 border border-line text-ink px-2 py-2 font-sans focus:outline-none focus:border-accent"
                    >
                      <option value="">
                        {accounts.isLoading ? 'Loading.' : 'Select account.'}
                      </option>
                      {accountItems.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={line.debit_cents}
                      onChange={(e) => setLineField(i, 'debit_cents', e.target.value)}
                      className="w-full bg-bg-2 border border-line text-ink px-2 py-2 font-mono text-right focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={line.credit_cents}
                      onChange={(e) => setLineField(i, 'credit_cents', e.target.value)}
                      className="w-full bg-bg-2 border border-line text-ink px-2 py-2 font-mono text-right focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={line.memo}
                      onChange={(e) => setLineField(i, 'memo', e.target.value)}
                      className="w-full bg-bg-2 border border-line text-ink px-2 py-2 font-sans focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      disabled={lines.length <= 2}
                      className="text-ink-dim font-display tracking-wider text-xs disabled:opacity-30"
                    >
                      REMOVE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="flex items-center justify-between bg-bg-2 border border-line px-4 py-3 font-mono text-sm">
          <span>
            Debits: {formatCents(totalDebit, 'USD')} · Credits:{' '}
            {formatCents(totalCredit, 'USD')}
          </span>
          <span className="flex items-center gap-2 font-display tracking-wider text-xs">
            BALANCED:
            {balanced ? (
              <CheckCircle className="text-accent" size={18} aria-label="Balanced" />
            ) : (
              <XCircle className="text-ink-dim" size={18} aria-label="Not balanced" />
            )}
          </span>
        </div>

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <Button type="submit" disabled={!balanced || create.isPending}>
          {create.isPending ? 'Saving.' : 'Save journal entry'}
        </Button>
      </form>
    </section>
  );
}
