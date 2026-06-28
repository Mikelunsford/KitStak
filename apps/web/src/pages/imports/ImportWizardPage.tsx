// ImportWizardPage. Three-step CSV import flow:
//   1) pick entity_type
//   2) upload a .csv file (or paste CSV text) -> parse -> validate dry-run
//   3) review errors -> commit

import { useMemo, useState, type ChangeEvent } from 'react';

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

// Per-entity CSV templates: the headers operators should use plus one example
// row. These MUST track the imports-api RowSchemas + ColumnAliases
// (supabase/functions/imports-api/index.ts). Friendly alias headers are used
// where the server accepts them (customer email/phone, invoice/expense number)
// so the downloaded template is operator-natural; the server maps them to the
// canonical columns. Keep the two in sync when import fields change.
const TEMPLATES: Record<ImportEntityType, { headers: string[]; example: string[] }> = {
  customer: {
    headers: [
      'display_name', 'email', 'phone', 'kind', 'tax_id',
      'default_currency_code', 'default_payment_terms_days',
      'billing_line1', 'billing_city', 'billing_region', 'billing_postal', 'billing_country',
      'shipping_line1', 'shipping_city', 'shipping_region', 'shipping_postal', 'shipping_country',
      'tags',
    ],
    example: [
      'Acme Co', 'billing@acme.test', '555-0100', 'company', 'TAX-123',
      'USD', '30',
      '100 Main St', 'Austin', 'TX', '78701', 'US',
      '100 Main St', 'Austin', 'TX', '78701', 'US',
      'wholesale;net30',
    ],
  },
  item: {
    // category / unit / tax accept a name OR code from your org's lists
    // (case-insensitive); the import resolves them to the right record.
    headers: [
      'sku', 'name', 'description', 'kind',
      'unit_price_cents', 'unit_cost_cents', 'currency_code',
      'unit_of_measure', 'reorder_point', 'barcode', 'supply_source',
      'is_active', 'is_taxable', 'is_sellable', 'is_purchasable',
      'category', 'unit', 'tax',
    ],
    example: [
      'SKU-001', 'Widget', 'A standard widget', 'product',
      '1999', '1200', 'USD',
      'Each', '25', '0123456789012', 'in_house',
      'true', 'true', 'true', 'false',
      'Hardware', 'EA', 'Standard Rate',
    ],
  },
  vendor: {
    headers: ['display_name', 'email', 'phone'],
    example: ['Globex Supply', 'ap@globex.test', '555-0200'],
  },
  invoice: {
    headers: ['number', 'customer_id', 'total_cents', 'currency_code'],
    example: ['INV-1001', 'paste-customer-uuid-here', '125000', 'USD'],
  },
  expense: {
    headers: ['number', 'vendor_id', 'amount_cents', 'currency_code'],
    example: ['EXP-1001', 'paste-vendor-uuid-here', '4999', 'USD'],
  },
};

// Minimal RFC-4180-ish escaping for the generated template cells.
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function templateCsv(entity: ImportEntityType): string {
  const t = TEMPLATES[entity];
  const header = t.headers.map(csvCell).join(',');
  const example = t.example.map(csvCell).join(',');
  return `${header}\n${example}\n`;
}

// Client-side download of a generated text file (no network round-trip).
function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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

  // Any change to the CSV (typed, pasted, or file-loaded) clears the prior
  // dry-run result so Commit (gated on validRows !== null) cannot fire against
  // rows that were never validated. The operator must re-validate first.
  function resetResults() {
    setErrors([]);
    setTotalRows(null);
    setValidRows(null);
    setInserted(null);
  }

  function handleCsvChange(text: string) {
    setCsvText(text);
    resetResults();
  }

  function handleEntityChange(next: ImportEntityType) {
    setEntity(next);
    // A prior validation was scoped to the old entity's schema; drop it.
    resetResults();
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input value so re-selecting the same file fires onChange again.
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    handleCsvChange(text);
  }

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
                onChange={() => handleEntityChange(e)}
              />
              <span className="text-ink">{e}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            downloadTextFile(`${entity}-import-template.csv`, templateCsv(entity))
          }
          className="mt-3 border border-line px-2 py-1 text-xs hover:bg-bg-3"
        >
          Download {entity} template
        </button>
      </fieldset>

      <fieldset className="border border-line p-4">
        <legend className="px-1 text-xs uppercase tracking-wider text-ink-dim">
          2. CSV
        </legend>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-dim">Upload a .csv file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="text-xs text-ink-dim file:mr-3 file:border file:border-line file:bg-bg-2 file:px-3 file:py-1 file:text-ink hover:file:bg-bg-3"
          />
        </label>
        <p className="mt-3 text-xs uppercase tracking-wider text-ink-faint">
          or paste CSV text
        </p>
        <textarea
          value={csvText}
          onChange={(e) => handleCsvChange(e.target.value)}
          rows={10}
          spellCheck={false}
          className="mt-1 w-full bg-bg-2 p-2 font-mono text-xs text-ink"
          placeholder={templateCsv(entity).trimEnd()}
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
