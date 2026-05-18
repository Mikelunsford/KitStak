// ImportWizardPage. Three-step CSV import flow:
//   1) pick entity_type
//   2) paste CSV text (or upload file) -> parse -> validate dry-run
//   3) review errors -> commit

import { useMemo, useState } from 'react';

import {
  validateImport,
  commitImport,
} from '@/lib/services/importsService';
import {
  ImportEntityTypeSchema,
  type ImportEntityType,
  type ImportRowError,
} from '@/lib/types/cross_cutting';

const ENTITIES: ImportEntityType[] = ImportEntityTypeSchema.options;

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0] as string;
  const header = splitLine(headerLine);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((col, idx) => {
      row[col] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (inQuotes) {
      if (c === '"' && line.charAt(i + 1) === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function ImportWizardPage() {
  const [entity, setEntity] = useState<ImportEntityType>('customer');
  const [csvText, setCsvText] = useState('');
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [validRows, setValidRows] = useState<number | null>(null);
  const [inserted, setInserted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => parseCsv(csvText), [csvText]);

  async function onValidate() {
    setBusy(true);
    setInserted(null);
    try {
      const res = await validateImport(entity, rows);
      setErrors(res.errors);
      setTotalRows(res.total_rows);
      setValidRows(res.valid_rows);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    setBusy(true);
    try {
      const res = await commitImport(entity, rows);
      setErrors(res.errors);
      setInserted(res.inserted);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-ink">
          IMPORT WIZARD
        </h1>
        <p className="text-sm text-ink-dim">
          Validate a CSV against the schema, then commit it. Dry-run is
          required before a commit can be issued.
        </p>
      </header>

      <fieldset className="border border-line p-4">
        <legend className="px-1 text-xs uppercase tracking-wider text-ink-dim">
          1. Entity
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ENTITIES.map((e) => (
            <label key={e} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="entity"
                checked={entity === e}
                onChange={() => setEntity(e)}
              />
              <span className="text-ink">{e}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="border border-line p-4">
        <legend className="px-1 text-xs uppercase tracking-wider text-ink-dim">
          2. CSV
        </legend>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={10}
          spellCheck={false}
          className="mt-2 w-full bg-bg-2 p-2 font-mono text-xs text-ink"
          placeholder="display_name,email&#10;Acme,billing@acme.test"
        />
        <p className="mt-1 text-xs text-ink-dim">
          {rows.length} parsed rows.
        </p>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onValidate}
          disabled={busy || rows.length === 0}
          className="border border-line bg-bg-2 px-3 py-1 text-sm hover:bg-bg-3 disabled:opacity-50"
        >
          Validate
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={busy || rows.length === 0 || validRows === null}
          className="border border-accent bg-accent px-3 py-1 text-sm text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          Commit
        </button>
      </div>

      {totalRows !== null ? (
        <section className="border border-line p-4">
          <h2 className="font-display text-lg tracking-wider text-ink">RESULT</h2>
          <p className="text-sm text-ink-dim">
            {validRows ?? 0} valid of {totalRows} rows.{' '}
            {inserted !== null ? `${inserted} inserted.` : null}
          </p>
          {errors.length > 0 ? (
            <ul className="mt-2 max-h-60 overflow-auto text-xs text-ink">
              {errors.map((e, i) => (
                <li key={`${e.row_number}-${e.field}-${i}`}>
                  Row {e.row_number}
                  {e.field ? ` field "${e.field}"` : ''}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
