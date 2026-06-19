// Unit tests for the Workstream C list-query helpers (2026-06-17 UI scan).
// These are the pure filter-query builders the list handlers compose onto a
// PostgREST query: search ILIKE fragments, sort-param parsing against an
// allowlist, the keyset cursor (encode/decode plus the .or() predicate), and
// the sorted paginator. The Supabase mock used by the handler regression
// suites does not reproduce .or()/.ilike(), so this is where the query-building
// logic is locked.

import { describe, it, expect } from 'vitest';

import {
  buildKeysetOr,
  buildSearchOr,
  decodeSortCursor,
  encodeSortCursor,
  escapeIlike,
  paginateSorted,
  parseSearch,
  parseSort,
  type SortSpec,
} from '../../../../supabase/functions/_shared/list-query.ts';

function u(qs: string): URL {
  return new URL(`https://example.test/list?${qs}`);
}

describe('escapeIlike', () => {
  it('escapes %, _, and backslash so they match literally', () => {
    expect(escapeIlike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
  it('leaves ordinary text untouched', () => {
    expect(escapeIlike('Smoke Co.')).toBe('Smoke Co.');
  });
});

describe('buildSearchOr', () => {
  it('wraps the term in wildcards and quotes each column ilike', () => {
    expect(buildSearchOr(['number', 'title'], 'tetris')).toBe(
      'number.ilike."*tetris*",title.ilike."*tetris*"',
    );
  });
  it('doubles internal quotes and escapes wildcards in the term', () => {
    expect(buildSearchOr(['sku'], 'a"b%c')).toBe('sku.ilike."*a""b\\%c*"');
  });
});

describe('parseSearch', () => {
  it('prefers ?search over ?q and trims', () => {
    expect(parseSearch(u('search=%20widget%20&q=other'))).toBe('widget');
  });
  it('falls back to ?q when search is absent', () => {
    expect(parseSearch(u('q=acme'))).toBe('acme');
  });
  it('returns empty string when neither is present', () => {
    expect(parseSearch(u('limit=50'))).toBe('');
  });
});

describe('parseSort', () => {
  const allowed = ['created_at', 'total_cents', 'state', 'number'] as const;
  const def: SortSpec = { column: 'created_at', dir: 'desc' };

  it('accepts an allowlisted column and direction', () => {
    expect(parseSort(u('sort_by=total_cents&sort_dir=asc'), allowed, def)).toEqual({
      column: 'total_cents',
      dir: 'asc',
    });
  });
  it('falls back to the default column when sort_by is not allowlisted', () => {
    expect(parseSort(u('sort_by=evil_col&sort_dir=asc'), allowed, def)).toEqual({
      column: 'created_at',
      dir: 'asc',
    });
  });
  it('falls back to the default direction when sort_dir is invalid', () => {
    expect(parseSort(u('sort_by=number&sort_dir=sideways'), allowed, def)).toEqual({
      column: 'number',
      dir: 'desc',
    });
  });
  it('returns the default when no sort params are present', () => {
    expect(parseSort(u('limit=50'), allowed, def)).toEqual(def);
  });
});

describe('sort cursor encode/decode', () => {
  it('round-trips a cursor', () => {
    const c = { v: '2026-06-17T00:00:00Z', id: 'abc' };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });
  it('round-trips a cursor with non-ASCII sort values (UTF-8 safe)', () => {
    const c = { v: 'Fizz 日本語 Co.', id: 'abc' };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });
  it('returns null for an absent cursor', () => {
    expect(decodeSortCursor(null)).toBeNull();
  });
  it('throws on a malformed cursor', () => {
    expect(() => decodeSortCursor('not-base64-json')).toThrow();
  });
  it('throws on a cursor missing required fields', () => {
    expect(() => decodeSortCursor(btoa(JSON.stringify({ v: 'x' })))).toThrow();
  });
});

describe('inventory-api warehouse allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/inventory-api/index.ts.
  // SEARCH_COLS are NOT NULL text columns; SORT_COLS are NOT NULL only so the
  // keyset cursor never straddles a null.
  const WAREHOUSE_SEARCH_COLS = ['display_name', 'code'] as const;
  const WAREHOUSE_SORT_COLS = ['created_at', 'display_name', 'code'] as const;
  const WAREHOUSE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches display_name and code with ilike', () => {
    expect(buildSearchOr(WAREHOUSE_SEARCH_COLS, 'east')).toBe(
      'display_name.ilike."*east*",code.ilike."*east*"',
    );
  });

  it('accepts an allowlisted sort column (code asc)', () => {
    expect(
      parseSort(u('sort_by=code&sort_dir=asc'), WAREHOUSE_SORT_COLS, WAREHOUSE_DEFAULT_SORT),
    ).toEqual({ column: 'code', dir: 'asc' });
  });

  it('rejects an off-allowlist sort column and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=is_active&sort_dir=asc'), WAREHOUSE_SORT_COLS, WAREHOUSE_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), WAREHOUSE_SORT_COLS, WAREHOUSE_DEFAULT_SORT)).toEqual(
      WAREHOUSE_DEFAULT_SORT,
    );
  });
});

describe('manufacturing-api manufacturing_run allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/manufacturing-api/index.ts.
  // run_number is nullable (migration 0052: text, partial unique index where
  // run_number is not null), so it is a SEARCH column only, never a sort.
  // status and created_at are the confirmed NOT NULL columns offered as sorts,
  // so the keyset cursor never straddles a null.
  const MANUFACTURING_RUN_SEARCH_COLS = ['run_number'] as const;
  const MANUFACTURING_RUN_SORT_COLS = ['created_at', 'status'] as const;
  const MANUFACTURING_RUN_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches run_number with ilike', () => {
    expect(buildSearchOr(MANUFACTURING_RUN_SEARCH_COLS, 'MFG-2026')).toBe(
      'run_number.ilike."*MFG-2026*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), MANUFACTURING_RUN_SORT_COLS, MANUFACTURING_RUN_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable run_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=run_number&sort_dir=asc'), MANUFACTURING_RUN_SORT_COLS, MANUFACTURING_RUN_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), MANUFACTURING_RUN_SORT_COLS, MANUFACTURING_RUN_DEFAULT_SORT)).toEqual(
      MANUFACTURING_RUN_DEFAULT_SORT,
    );
  });
});

describe('crm-api contact allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/crm-api/handlers/contacts.ts.
  // last_name and email are nullable, so they are SEARCH columns only; SORT_COLS
  // are NOT NULL only (created_at, first_name) so the keyset cursor never
  // straddles a null.
  const CONTACT_SEARCH_COLS = ['first_name', 'last_name', 'email'] as const;
  const CONTACT_SORT_COLS = ['created_at', 'first_name'] as const;
  const CONTACT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches first_name, last_name, and email with ilike', () => {
    expect(buildSearchOr(CONTACT_SEARCH_COLS, 'alex')).toBe(
      'first_name.ilike."*alex*",last_name.ilike."*alex*",email.ilike."*alex*"',
    );
  });

  it('accepts an allowlisted sort column (first_name asc)', () => {
    expect(
      parseSort(u('sort_by=first_name&sort_dir=asc'), CONTACT_SORT_COLS, CONTACT_DEFAULT_SORT),
    ).toEqual({ column: 'first_name', dir: 'asc' });
  });

  it('rejects the nullable email as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=email&sort_dir=asc'), CONTACT_SORT_COLS, CONTACT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), CONTACT_SORT_COLS, CONTACT_DEFAULT_SORT)).toEqual(
      CONTACT_DEFAULT_SORT,
    );
  });
});

describe('crm-api activity allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/crm-api/handlers/activities.ts.
  // body is nullable, so it is a SEARCH column only; SORT_COLS are NOT NULL only
  // (created_at, status) so the keyset cursor never straddles a null.
  const ACTIVITY_SEARCH_COLS = ['subject', 'body'] as const;
  const ACTIVITY_SORT_COLS = ['created_at', 'status'] as const;
  const ACTIVITY_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches subject and body with ilike', () => {
    expect(buildSearchOr(ACTIVITY_SEARCH_COLS, 'follow up')).toBe(
      'subject.ilike."*follow up*",body.ilike."*follow up*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), ACTIVITY_SORT_COLS, ACTIVITY_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable body as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=body&sort_dir=asc'), ACTIVITY_SORT_COLS, ACTIVITY_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), ACTIVITY_SORT_COLS, ACTIVITY_DEFAULT_SORT)).toEqual(
      ACTIVITY_DEFAULT_SORT,
    );
  });
});

describe('vendors-api vendor allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/vendors-api/handlers/vendors.ts. vendor_number is
  // nullable (unique only where present, migration 0025), so it is a SEARCH
  // column only, never a sort. display_name and created_at are the confirmed
  // NOT NULL columns offered as sorts, so the keyset cursor never straddles a
  // null.
  const VENDOR_SEARCH_COLS = ['display_name', 'vendor_number'] as const;
  const VENDOR_SORT_COLS = ['created_at', 'display_name'] as const;
  const VENDOR_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches display_name and vendor_number with ilike', () => {
    expect(buildSearchOr(VENDOR_SEARCH_COLS, 'acme')).toBe(
      'display_name.ilike."*acme*",vendor_number.ilike."*acme*"',
    );
  });

  it('accepts an allowlisted sort column (display_name asc)', () => {
    expect(
      parseSort(u('sort_by=display_name&sort_dir=asc'), VENDOR_SORT_COLS, VENDOR_DEFAULT_SORT),
    ).toEqual({ column: 'display_name', dir: 'asc' });
  });

  it('rejects the nullable vendor_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=vendor_number&sort_dir=asc'), VENDOR_SORT_COLS, VENDOR_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), VENDOR_SORT_COLS, VENDOR_DEFAULT_SORT)).toEqual(
      VENDOR_DEFAULT_SORT,
    );
  });
});

describe('vendors-api purchase_order allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/vendors-api/handlers/purchase-orders.ts. po_number is
  // nullable (unique only where present, migration 0026), so it is a SEARCH
  // column only, never a sort. created_at, status, and order_date are the
  // confirmed NOT NULL columns offered as sorts, so the keyset cursor never
  // straddles a null.
  const PO_SEARCH_COLS = ['po_number'] as const;
  const PO_SORT_COLS = ['created_at', 'status', 'order_date'] as const;
  const PO_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches po_number with ilike', () => {
    expect(buildSearchOr(PO_SEARCH_COLS, 'PO-2026')).toBe(
      'po_number.ilike."*PO-2026*"',
    );
  });

  it('accepts an allowlisted sort column (order_date asc)', () => {
    expect(
      parseSort(u('sort_by=order_date&sort_dir=asc'), PO_SORT_COLS, PO_DEFAULT_SORT),
    ).toEqual({ column: 'order_date', dir: 'asc' });
  });

  it('rejects the nullable po_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=po_number&sort_dir=asc'), PO_SORT_COLS, PO_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), PO_SORT_COLS, PO_DEFAULT_SORT)).toEqual(
      PO_DEFAULT_SORT,
    );
  });
});

describe('vendors-api expense allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/vendors-api/handlers/expenses.ts. expense_number is
  // nullable (unique only where present, migration 0028), so it is a SEARCH
  // column only, never a sort. created_at, status, and expense_date are the
  // confirmed NOT NULL columns offered as sorts, so the keyset cursor never
  // straddles a null.
  const EXPENSE_SEARCH_COLS = ['expense_number'] as const;
  const EXPENSE_SORT_COLS = ['created_at', 'status', 'expense_date'] as const;
  const EXPENSE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches expense_number with ilike', () => {
    expect(buildSearchOr(EXPENSE_SEARCH_COLS, 'EXP-9')).toBe(
      'expense_number.ilike."*EXP-9*"',
    );
  });

  it('accepts an allowlisted sort column (expense_date asc)', () => {
    expect(
      parseSort(u('sort_by=expense_date&sort_dir=asc'), EXPENSE_SORT_COLS, EXPENSE_DEFAULT_SORT),
    ).toEqual({ column: 'expense_date', dir: 'asc' });
  });

  it('rejects the nullable expense_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=expense_number&sort_dir=asc'), EXPENSE_SORT_COLS, EXPENSE_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), EXPENSE_SORT_COLS, EXPENSE_DEFAULT_SORT)).toEqual(
      EXPENSE_DEFAULT_SORT,
    );
  });
});

describe('finance-api journal_entry allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/finance-api/handlers/journal_entries.ts. entry_number
  // carries a unique(org_id, entry_number) but is the identifier column, so it
  // is a SEARCH column only, never a sort. created_at, entry_date, and status
  // are the confirmed NOT NULL columns offered as sorts (migration 0022), so
  // the keyset cursor never straddles a null.
  const JE_SEARCH_COLS = ['entry_number'] as const;
  const JE_SORT_COLS = ['created_at', 'entry_date', 'status'] as const;
  const JE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches entry_number with ilike', () => {
    expect(buildSearchOr(JE_SEARCH_COLS, 'JE-M-2026')).toBe(
      'entry_number.ilike."*JE-M-2026*"',
    );
  });

  it('accepts an allowlisted sort column (entry_date asc)', () => {
    expect(
      parseSort(u('sort_by=entry_date&sort_dir=asc'), JE_SORT_COLS, JE_DEFAULT_SORT),
    ).toEqual({ column: 'entry_date', dir: 'asc' });
  });

  it('rejects the identifier entry_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=entry_number&sort_dir=asc'), JE_SORT_COLS, JE_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), JE_SORT_COLS, JE_DEFAULT_SORT)).toEqual(
      JE_DEFAULT_SORT,
    );
  });
});

describe('projects-api project allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/projects-api/index.ts.
  // number is the identifier column (unique(org_id, number), migration 0016), so
  // it is a SEARCH column only, never a sort. name, state, and created_at are the
  // confirmed NOT NULL columns offered as sorts, so the keyset cursor never
  // straddles a null. The state facet and the customer_id FK filter stay .eq
  // filters, never sorts.
  const PROJECT_SEARCH_COLS = ['name', 'number'] as const;
  const PROJECT_SORT_COLS = ['created_at', 'name', 'state'] as const;
  const PROJECT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches name and number with ilike', () => {
    expect(buildSearchOr(PROJECT_SEARCH_COLS, 'PRJ-2026')).toBe(
      'name.ilike."*PRJ-2026*",number.ilike."*PRJ-2026*"',
    );
  });

  it('accepts an allowlisted sort column (name asc)', () => {
    expect(
      parseSort(u('sort_by=name&sort_dir=asc'), PROJECT_SORT_COLS, PROJECT_DEFAULT_SORT),
    ).toEqual({ column: 'name', dir: 'asc' });
  });

  it('rejects the identifier number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=number&sort_dir=asc'), PROJECT_SORT_COLS, PROJECT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('rejects the customer_id facet as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=customer_id&sort_dir=asc'), PROJECT_SORT_COLS, PROJECT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), PROJECT_SORT_COLS, PROJECT_DEFAULT_SORT)).toEqual(
      PROJECT_DEFAULT_SORT,
    );
  });
});

describe('three-pl-api account allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/three-pl-api/handlers/accounts.ts. account_number is
  // nullable (migration 0089), so it is a SEARCH column only, never a sort. name,
  // status, and created_at are the confirmed NOT NULL columns offered as sorts,
  // so the keyset cursor never straddles a null.
  const ACCOUNT_SEARCH_COLS = ['name', 'account_number'] as const;
  const ACCOUNT_SORT_COLS = ['created_at', 'name', 'status'] as const;
  const ACCOUNT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches name and account_number with ilike', () => {
    expect(buildSearchOr(ACCOUNT_SEARCH_COLS, 'acme')).toBe(
      'name.ilike."*acme*",account_number.ilike."*acme*"',
    );
  });

  it('accepts an allowlisted sort column (name asc)', () => {
    expect(
      parseSort(u('sort_by=name&sort_dir=asc'), ACCOUNT_SORT_COLS, ACCOUNT_DEFAULT_SORT),
    ).toEqual({ column: 'name', dir: 'asc' });
  });

  it('rejects the nullable account_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=account_number&sort_dir=asc'), ACCOUNT_SORT_COLS, ACCOUNT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), ACCOUNT_SORT_COLS, ACCOUNT_DEFAULT_SORT)).toEqual(
      ACCOUNT_DEFAULT_SORT,
    );
  });
});

describe('three-pl-api job_template allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/three-pl-api/handlers/job_templates.ts. template_number is
  // nullable (migration 0091), so it is a SEARCH column only, never a sort. name,
  // status, and created_at are the confirmed NOT NULL columns offered as sorts,
  // so the keyset cursor never straddles a null. The variant facet stays an .eq
  // filter, never a sort.
  const JOB_TEMPLATE_SEARCH_COLS = ['name', 'template_number'] as const;
  const JOB_TEMPLATE_SORT_COLS = ['created_at', 'name', 'status'] as const;
  const JOB_TEMPLATE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches name and template_number with ilike', () => {
    expect(buildSearchOr(JOB_TEMPLATE_SEARCH_COLS, 'kit')).toBe(
      'name.ilike."*kit*",template_number.ilike."*kit*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), JOB_TEMPLATE_SORT_COLS, JOB_TEMPLATE_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the variant facet as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=variant&sort_dir=asc'), JOB_TEMPLATE_SORT_COLS, JOB_TEMPLATE_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), JOB_TEMPLATE_SORT_COLS, JOB_TEMPLATE_DEFAULT_SORT)).toEqual(
      JOB_TEMPLATE_DEFAULT_SORT,
    );
  });
});

describe('three-pl-api supply_plan allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/three-pl-api/handlers/supply_plans.ts. plan_number is
  // nullable (migration 0096), so it is a SEARCH column only, never a sort.
  // status and created_at are the confirmed NOT NULL columns offered as sorts,
  // so the keyset cursor never straddles a null.
  const SUPPLY_PLAN_SEARCH_COLS = ['plan_number'] as const;
  const SUPPLY_PLAN_SORT_COLS = ['created_at', 'status'] as const;
  const SUPPLY_PLAN_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches plan_number with ilike', () => {
    expect(buildSearchOr(SUPPLY_PLAN_SEARCH_COLS, 'SUP-12')).toBe(
      'plan_number.ilike."*SUP-12*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), SUPPLY_PLAN_SORT_COLS, SUPPLY_PLAN_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable plan_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=plan_number&sort_dir=asc'), SUPPLY_PLAN_SORT_COLS, SUPPLY_PLAN_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), SUPPLY_PLAN_SORT_COLS, SUPPLY_PLAN_DEFAULT_SORT)).toEqual(
      SUPPLY_PLAN_DEFAULT_SORT,
    );
  });
});

describe('three-pl-api job_run allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/three-pl-api/handlers/job_runs.ts. run_number is nullable
  // (migration 0098), so it is a SEARCH column only, never a sort. status and
  // created_at are the confirmed NOT NULL columns offered as sorts, so the keyset
  // cursor never straddles a null.
  const JOB_RUN_SEARCH_COLS = ['run_number'] as const;
  const JOB_RUN_SORT_COLS = ['created_at', 'status'] as const;
  const JOB_RUN_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches run_number with ilike', () => {
    expect(buildSearchOr(JOB_RUN_SEARCH_COLS, 'JR-7')).toBe(
      'run_number.ilike."*JR-7*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), JOB_RUN_SORT_COLS, JOB_RUN_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable run_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=run_number&sort_dir=asc'), JOB_RUN_SORT_COLS, JOB_RUN_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), JOB_RUN_SORT_COLS, JOB_RUN_DEFAULT_SORT)).toEqual(
      JOB_RUN_DEFAULT_SORT,
    );
  });
});

describe('three-pl-api billing_review allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in
  // supabase/functions/three-pl-api/handlers/billing_reviews.ts. review_number is
  // nullable (migration 0102), so it is a SEARCH column only, never a sort. The
  // money totals (estimate / actual) are nullable too, so they are not sorts.
  // status and created_at are the confirmed NOT NULL columns offered as sorts, so
  // the keyset cursor never straddles a null.
  const BILLING_REVIEW_SEARCH_COLS = ['review_number'] as const;
  const BILLING_REVIEW_SORT_COLS = ['created_at', 'status'] as const;
  const BILLING_REVIEW_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches review_number with ilike', () => {
    expect(buildSearchOr(BILLING_REVIEW_SEARCH_COLS, 'BILL-3')).toBe(
      'review_number.ilike."*BILL-3*"',
    );
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), BILLING_REVIEW_SORT_COLS, BILLING_REVIEW_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable estimate_total_cents as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=estimate_total_cents&sort_dir=asc'), BILLING_REVIEW_SORT_COLS, BILLING_REVIEW_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), BILLING_REVIEW_SORT_COLS, BILLING_REVIEW_DEFAULT_SORT)).toEqual(
      BILLING_REVIEW_DEFAULT_SORT,
    );
  });
});

describe('wms-api warehouse_location allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/wms-api/index.ts. code is
  // NOT NULL (migration 0106), so it is both a SEARCH and a SORT column;
  // location_type is NOT NULL too. active / parent_location_id stay .eq facets,
  // never sorts. created_at is the default sort. The keyset cursor never
  // straddles a null.
  const LOCATION_SEARCH_COLS = ['code'] as const;
  const LOCATION_SORT_COLS = ['created_at', 'code', 'location_type'] as const;
  const LOCATION_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches code with ilike', () => {
    expect(buildSearchOr(LOCATION_SEARCH_COLS, 'A-01')).toBe(
      'code.ilike."*A-01*"',
    );
  });

  it('accepts an allowlisted sort column (code asc)', () => {
    expect(
      parseSort(u('sort_by=code&sort_dir=asc'), LOCATION_SORT_COLS, LOCATION_DEFAULT_SORT),
    ).toEqual({ column: 'code', dir: 'asc' });
  });

  it('rejects the active facet as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=active&sort_dir=asc'), LOCATION_SORT_COLS, LOCATION_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), LOCATION_SORT_COLS, LOCATION_DEFAULT_SORT)).toEqual(
      LOCATION_DEFAULT_SORT,
    );
  });
});

describe('wms-api bin_stock_level allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/wms-api/index.ts. The rollup
  // (migration 0107) has no text identifier column, so SEARCH_COLS is empty.
  // updated_at and quantity_on_hand are the confirmed NOT NULL columns offered
  // as sorts; there is no created_at on the rollup, so updated_at desc is the
  // default. The keyset cursor never straddles a null.
  const BIN_STOCK_SEARCH_COLS = [] as const;
  const BIN_STOCK_SORT_COLS = ['updated_at', 'quantity_on_hand'] as const;
  const BIN_STOCK_DEFAULT_SORT: SortSpec = { column: 'updated_at', dir: 'desc' };

  it('builds an empty search fragment when there are no search columns', () => {
    expect(buildSearchOr(BIN_STOCK_SEARCH_COLS, 'anything')).toBe('');
  });

  it('accepts an allowlisted sort column (quantity_on_hand asc)', () => {
    expect(
      parseSort(u('sort_by=quantity_on_hand&sort_dir=asc'), BIN_STOCK_SORT_COLS, BIN_STOCK_DEFAULT_SORT),
    ).toEqual({ column: 'quantity_on_hand', dir: 'asc' });
  });

  it('rejects the nullable lot_id as a sort and falls back to updated_at desc', () => {
    expect(
      parseSort(u('sort_by=lot_id&sort_dir=asc'), BIN_STOCK_SORT_COLS, BIN_STOCK_DEFAULT_SORT),
    ).toEqual({ column: 'updated_at', dir: 'asc' });
  });

  it('defaults to updated_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), BIN_STOCK_SORT_COLS, BIN_STOCK_DEFAULT_SORT)).toEqual(
      BIN_STOCK_DEFAULT_SORT,
    );
  });
});

describe('wms-api putaway_task allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/wms-api/index.ts. The task
  // (migration 0109) has no text identifier column (source_entity_type is a
  // nullable audit ref), so SEARCH_COLS is empty. status and created_at are the
  // confirmed NOT NULL columns offered as sorts, so the keyset cursor never
  // straddles a null.
  const PUTAWAY_SEARCH_COLS = [] as const;
  const PUTAWAY_SORT_COLS = ['created_at', 'status'] as const;
  const PUTAWAY_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('builds an empty search fragment when there are no search columns', () => {
    expect(buildSearchOr(PUTAWAY_SEARCH_COLS, 'anything')).toBe('');
  });

  it('accepts an allowlisted sort column (status asc)', () => {
    expect(
      parseSort(u('sort_by=status&sort_dir=asc'), PUTAWAY_SORT_COLS, PUTAWAY_DEFAULT_SORT),
    ).toEqual({ column: 'status', dir: 'asc' });
  });

  it('rejects the nullable source_entity_type as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=source_entity_type&sort_dir=asc'), PUTAWAY_SORT_COLS, PUTAWAY_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), PUTAWAY_SORT_COLS, PUTAWAY_DEFAULT_SORT)).toEqual(
      PUTAWAY_DEFAULT_SORT,
    );
  });
});

describe('wms-api lot allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/wms-api/index.ts. lot_code is
  // NOT NULL (migration 0110), so it is both a SEARCH and a SORT column; status
  // is NOT NULL too. expiration_date / received_at are nullable, so they stay
  // filters, never sorts. created_at is the default. The keyset cursor never
  // straddles a null.
  const LOT_SEARCH_COLS = ['lot_code'] as const;
  const LOT_SORT_COLS = ['created_at', 'lot_code', 'status'] as const;
  const LOT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches lot_code with ilike', () => {
    expect(buildSearchOr(LOT_SEARCH_COLS, 'LOT-5')).toBe(
      'lot_code.ilike."*LOT-5*"',
    );
  });

  it('accepts an allowlisted sort column (lot_code asc)', () => {
    expect(
      parseSort(u('sort_by=lot_code&sort_dir=asc'), LOT_SORT_COLS, LOT_DEFAULT_SORT),
    ).toEqual({ column: 'lot_code', dir: 'asc' });
  });

  it('rejects the nullable expiration_date as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=expiration_date&sort_dir=asc'), LOT_SORT_COLS, LOT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), LOT_SORT_COLS, LOT_DEFAULT_SORT)).toEqual(
      LOT_DEFAULT_SORT,
    );
  });
});

describe('kitforce-api workforce_member allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/kitforce-api/index.ts.
  // member_number and email are nullable (migration 0078), so they are SEARCH
  // columns only; display_name, status, created_at are the confirmed NOT NULL
  // columns offered as sorts, so the keyset cursor never straddles a null.
  const MEMBER_SEARCH_COLS = ['display_name', 'member_number', 'email'] as const;
  const MEMBER_SORT_COLS = ['created_at', 'display_name', 'status'] as const;
  const MEMBER_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches display_name, member_number, and email with ilike', () => {
    expect(buildSearchOr(MEMBER_SEARCH_COLS, 'rivera')).toBe(
      'display_name.ilike."*rivera*",member_number.ilike."*rivera*",email.ilike."*rivera*"',
    );
  });

  it('accepts an allowlisted sort column (display_name asc)', () => {
    expect(
      parseSort(u('sort_by=display_name&sort_dir=asc'), MEMBER_SORT_COLS, MEMBER_DEFAULT_SORT),
    ).toEqual({ column: 'display_name', dir: 'asc' });
  });

  it('rejects the nullable member_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=member_number&sort_dir=asc'), MEMBER_SORT_COLS, MEMBER_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), MEMBER_SORT_COLS, MEMBER_DEFAULT_SORT)).toEqual(
      MEMBER_DEFAULT_SORT,
    );
  });
});

describe('kitforce-api workforce_team allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/kitforce-api/index.ts.
  // name is NOT NULL (migration 0078); is_active is the facet, never a sort.
  // created_at and name are the confirmed NOT NULL sort columns, so the keyset
  // cursor never straddles a null.
  const TEAM_SEARCH_COLS = ['name'] as const;
  const TEAM_SORT_COLS = ['created_at', 'name'] as const;
  const TEAM_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches name with ilike', () => {
    expect(buildSearchOr(TEAM_SEARCH_COLS, 'pick crew')).toBe(
      'name.ilike."*pick crew*"',
    );
  });

  it('accepts an allowlisted sort column (name asc)', () => {
    expect(
      parseSort(u('sort_by=name&sort_dir=asc'), TEAM_SORT_COLS, TEAM_DEFAULT_SORT),
    ).toEqual({ column: 'name', dir: 'asc' });
  });

  it('rejects the is_active facet as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=is_active&sort_dir=asc'), TEAM_SORT_COLS, TEAM_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), TEAM_SORT_COLS, TEAM_DEFAULT_SORT)).toEqual(
      TEAM_DEFAULT_SORT,
    );
  });
});

describe('kitforce-api shift allowlist (Workstream C keyset)', () => {
  // Mirrors the quad declared in supabase/functions/kitforce-api/index.ts.
  // shift_number is nullable (migration 0084), so it is a SEARCH column only,
  // never a sort. status, scheduled_start_at, scheduled_end_at, and created_at
  // are the confirmed NOT NULL columns offered as sorts (migration 0079), so the
  // keyset cursor never straddles a null.
  const SHIFT_SEARCH_COLS = ['shift_number'] as const;
  const SHIFT_SORT_COLS = [
    'created_at', 'status', 'scheduled_start_at', 'scheduled_end_at',
  ] as const;
  const SHIFT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches shift_number with ilike', () => {
    expect(buildSearchOr(SHIFT_SEARCH_COLS, 'SHF-7')).toBe(
      'shift_number.ilike."*SHF-7*"',
    );
  });

  it('accepts an allowlisted sort column (scheduled_start_at asc)', () => {
    expect(
      parseSort(u('sort_by=scheduled_start_at&sort_dir=asc'), SHIFT_SORT_COLS, SHIFT_DEFAULT_SORT),
    ).toEqual({ column: 'scheduled_start_at', dir: 'asc' });
  });

  it('rejects the nullable shift_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=shift_number&sort_dir=asc'), SHIFT_SORT_COLS, SHIFT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), SHIFT_SORT_COLS, SHIFT_DEFAULT_SORT)).toEqual(
      SHIFT_DEFAULT_SORT,
    );
  });
});

describe('kitforce-api work_assignment allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/kitforce-api/index.ts.
  // assignment_number is nullable (migration 0080), so it is a SEARCH column
  // only, never a sort. title, status, and created_at are the confirmed NOT NULL
  // columns offered as sorts, so the keyset cursor never straddles a null.
  const ASSIGNMENT_SEARCH_COLS = ['title', 'assignment_number'] as const;
  const ASSIGNMENT_SORT_COLS = ['created_at', 'title', 'status'] as const;
  const ASSIGNMENT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches title and assignment_number with ilike', () => {
    expect(buildSearchOr(ASSIGNMENT_SEARCH_COLS, 'palletize')).toBe(
      'title.ilike."*palletize*",assignment_number.ilike."*palletize*"',
    );
  });

  it('accepts an allowlisted sort column (title asc)', () => {
    expect(
      parseSort(u('sort_by=title&sort_dir=asc'), ASSIGNMENT_SORT_COLS, ASSIGNMENT_DEFAULT_SORT),
    ).toEqual({ column: 'title', dir: 'asc' });
  });

  it('rejects the nullable assignment_number as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=assignment_number&sort_dir=asc'), ASSIGNMENT_SORT_COLS, ASSIGNMENT_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), ASSIGNMENT_SORT_COLS, ASSIGNMENT_DEFAULT_SORT)).toEqual(
      ASSIGNMENT_DEFAULT_SORT,
    );
  });
});

describe('kitforce-api time_entry allowlist (Workstream C keyset)', () => {
  // Mirrors the trio declared in supabase/functions/kitforce-api/index.ts.
  // time_entries has no number or name column; notes is the only free-text
  // column (nullable, so SEARCH only). clock_in_at and created_at are the
  // confirmed NOT NULL columns offered as sorts (migration 0081), so the keyset
  // cursor never straddles a null. minutes / hourly_rate_cents are not sorts.
  const TIME_ENTRY_SEARCH_COLS = ['notes'] as const;
  const TIME_ENTRY_SORT_COLS = ['created_at', 'clock_in_at'] as const;
  const TIME_ENTRY_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

  it('searches notes with ilike', () => {
    expect(buildSearchOr(TIME_ENTRY_SEARCH_COLS, 'overtime')).toBe(
      'notes.ilike."*overtime*"',
    );
  });

  it('accepts an allowlisted sort column (clock_in_at asc)', () => {
    expect(
      parseSort(u('sort_by=clock_in_at&sort_dir=asc'), TIME_ENTRY_SORT_COLS, TIME_ENTRY_DEFAULT_SORT),
    ).toEqual({ column: 'clock_in_at', dir: 'asc' });
  });

  it('rejects the nullable minutes as a sort and falls back to created_at desc', () => {
    expect(
      parseSort(u('sort_by=minutes&sort_dir=asc'), TIME_ENTRY_SORT_COLS, TIME_ENTRY_DEFAULT_SORT),
    ).toEqual({ column: 'created_at', dir: 'asc' });
  });

  it('defaults to created_at desc when no sort params are present', () => {
    expect(parseSort(u('limit=50'), TIME_ENTRY_SORT_COLS, TIME_ENTRY_DEFAULT_SORT)).toEqual(
      TIME_ENTRY_DEFAULT_SORT,
    );
  });
});

describe('buildKeysetOr', () => {
  it('uses gt for ascending order', () => {
    expect(buildKeysetOr({ column: 'number', dir: 'asc' }, { v: 'Q-5', id: 'i1' })).toBe(
      'number.gt."Q-5",and(number.eq."Q-5",id.gt."i1")',
    );
  });
  it('uses lt for descending order', () => {
    expect(
      buildKeysetOr({ column: 'created_at', dir: 'desc' }, { v: '2026-06-17', id: 'i9' }),
    ).toBe('created_at.lt."2026-06-17",and(created_at.eq."2026-06-17",id.lt."i9")');
  });
  it('quotes a value containing a comma so it cannot break the grammar', () => {
    expect(buildKeysetOr({ column: 'number', dir: 'asc' }, { v: 'A,B', id: 'i1' })).toBe(
      'number.gt."A,B",and(number.eq."A,B",id.gt."i1")',
    );
  });
});

describe('paginateSorted', () => {
  const rows = [
    { id: 'a', total_cents: 100 },
    { id: 'b', total_cents: 200 },
    { id: 'c', total_cents: 300 },
  ];

  it('returns all rows and a null cursor when at or under the limit', () => {
    const page = paginateSorted(rows, 3, 'total_cents');
    expect(page.items).toHaveLength(3);
    expect(page.next_cursor).toBeNull();
  });

  it('trims to the limit and emits a cursor keyed on the sort column', () => {
    const page = paginateSorted(rows, 2, 'total_cents');
    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).not.toBeNull();
    expect(decodeSortCursor(page.next_cursor)).toEqual({ v: '300', id: 'c' });
  });

  it('stringifies the sort value (numeric column) into the cursor', () => {
    const page = paginateSorted(rows, 1, 'total_cents');
    expect(decodeSortCursor(page.next_cursor)).toEqual({ v: '200', id: 'b' });
  });

  it('throws when the cursor row has a null sort value (allowlist invariant)', () => {
    const withNull: Array<Record<string, unknown> & { id: string }> = [
      { id: 'a', total_cents: 100 },
      { id: 'b', total_cents: null },
    ];
    expect(() => paginateSorted(withNull, 1, 'total_cents')).toThrow();
  });
});
