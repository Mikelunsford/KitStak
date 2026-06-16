// Minimal Supabase client mock for regression tests.
//
// Reproduces the PostgREST chainable-query shape that the edge handlers use:
//   client.from(table).select(cols).eq(col,val).is(col,val).order(col,opts).limit(n)
//   client.from(table).select(cols).eq('id',id).eq('org_id',org).maybeSingle()
//   client.from(table).update(patch).eq(col,val) (.select(cols).maybeSingle())
//   client.from(table).insert(row).select(cols).maybeSingle()
//   client.rpc(name, args)
//
// The mock is *table-aware*: tests register a row-set per table, plus an
// optional "update spy" that captures (filters, patch) tuples. The mock
// returns a thenable that resolves to `{ data, error }` so the same builder
// works in both `await ...` and `.then(...)` positions.
//
// The mock filters rows in-memory to honour `.eq()` and `.is()` predicates,
// applies `.order()` (single column), and caps with `.limit()`. That is
// enough to exercise pagination logic faithfully.

import type { Caller } from '../../../../../supabase/functions/_shared/tenant.ts';

export interface RowMap {
  [table: string]: Array<Record<string, unknown>>;
}

interface UpdateRecord {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
}

export interface AuthAdminInviteCall {
  email: string;
  options?: { redirectTo?: string } | undefined;
}

export interface AuthAdminGenerateLinkCall {
  type: string;
  email: string;
  options?: { redirectTo?: string } | undefined;
}

export interface MockState {
  rows: RowMap;
  updates: UpdateRecord[];
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  rpcCalls: Array<{ name: string; args: unknown }>;
  rpcResults: Record<string, { data: unknown; error: unknown }>;
  authAdminInviteCalls: AuthAdminInviteCall[];
  authAdminInviteResult: {
    data: { user: { id: string; email: string } | null };
    error: { message: string } | null;
  };
  authAdminGenerateLinkCalls: AuthAdminGenerateLinkCall[];
  authAdminGenerateLinkResult: {
    data: {
      user: { id: string; email: string } | null;
      properties: { action_link: string } | null;
    };
    error: { message: string } | null;
  };
  authAdminListUsersCalls: Array<{ filter?: string; perPage?: number }>;
  authAdminListUsersResult: {
    data: { users: Array<{ id: string; email: string }> } | null;
    error: { message: string } | null;
  };
  authAdminUpdateUserByIdCalls: Array<{
    id: string;
    attributes: { app_metadata?: Record<string, unknown> };
  }>;
  authAdminUpdateUserByIdResult: {
    data: { user: { id: string } | null };
    error: { message: string } | null;
  };
  // Per-user override map for getUserById. Lets tests specify a richer
  // auth.users payload (notably email_confirmed_at) so the staff members
  // list endpoint can compute the `claimed` field per row. Missing entries
  // fall back to the default echo behaviour below.
  authAdminGetUserByIdResults: Record<
    string,
    {
      data: {
        user: {
          id: string;
          email: string;
          email_confirmed_at: string | null;
        } | null;
      };
      error: { message: string } | null;
    }
  >;
  authAdminGetUserByIdCalls: string[];
  // Optional per-table unique-key constraints. When set, an insert whose row
  // value at the named column already exists in `state.rows[table]` returns
  // a Postgres 23505 unique-violation error. Used by regression suites that
  // need to exercise duplicate-key short-circuit paths (e.g. stripe-webhook
  // event_id replay).
  insertConstraints?: Record<string, { column: string }>;
  // Opt-in concurrent-transition simulation for the status-equals-from guard
  // (R-W13-FIN-01). When a table name maps to a sentinel status here, the
  // FIRST maybeSingle/single SELECT against that table returns the row at its
  // seeded status, then advances the stored row's status to the sentinel. The
  // handler therefore reads the original (stale) status, passes its FSM guard,
  // and issues an UPDATE filtered on the stale status. That UPDATE now matches
  // 0 rows because the stored status moved to the sentinel, exactly as a
  // concurrent commit landing between the SELECT and the UPDATE would. The
  // handler surfaces the 0-row result as STATE_CONFLICT 409. Default unset, so
  // existing suites are unaffected. One-shot per table: the advance fires only
  // while the stored status still differs from the sentinel.
  raceAdvanceStatusOnSelect?: Record<string, string>;
}

export function makeState(rows: RowMap = {}): MockState {
  return {
    rows,
    updates: [],
    inserts: [],
    rpcCalls: [],
    rpcResults: {},
    authAdminInviteCalls: [],
    authAdminInviteResult: {
      data: {
        user: {
          id: '00000000-0000-4000-8000-00000000aaaa',
          email: 'default-mock@example.test',
        },
      },
      error: null,
    },
    authAdminGenerateLinkCalls: [],
    authAdminGenerateLinkResult: {
      data: {
        user: {
          id: '00000000-0000-4000-8000-00000000aaaa',
          email: 'default-mock@example.test',
        },
        properties: {
          action_link: 'https://default-mock.test/#token=fake',
        },
      },
      error: null,
    },
    authAdminListUsersCalls: [],
    authAdminListUsersResult: {
      data: { users: [] },
      error: null,
    },
    authAdminUpdateUserByIdCalls: [],
    authAdminUpdateUserByIdResult: {
      data: { user: { id: '00000000-0000-4000-8000-00000000aaaa' } },
      error: null,
    },
    authAdminGetUserByIdResults: {},
    authAdminGetUserByIdCalls: [],
  };
}

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'is'; col: string; val: unknown }
  | { kind: 'in'; col: string; val: ReadonlyArray<unknown> }
  | { kind: 'gte'; col: string; val: unknown };

function applyFilters(
  rows: Array<Record<string, unknown>>,
  filters: Filter[],
): Array<Record<string, unknown>> {
  return rows.filter((row) =>
    filters.every((f) => {
      const cur = row[f.col];
      if (f.kind === 'is') {
        if (f.val === null) return cur === null || cur === undefined;
        return cur === f.val;
      }
      if (f.kind === 'in') {
        return f.val.includes(cur);
      }
      if (f.kind === 'gte') {
        // String-comparable for ISO dates (YYYY-MM-DD); numeric otherwise.
        if (cur === null || cur === undefined) return false;
        return (cur as string | number) >= (f.val as string | number);
      }
      // eq: value equality (Postgres treats string and number distinctly;
      // for our fixtures, all keys are strings so this is safe)
      return cur === f.val;
    }),
  );
}

interface QueryBuilder {
  select: (cols?: string, opts?: { count?: 'exact'; head?: boolean }) => QueryBuilder;
  eq: (col: string, val: unknown) => QueryBuilder;
  is: (col: string, val: unknown) => QueryBuilder;
  in: (col: string, val: ReadonlyArray<unknown>) => QueryBuilder;
  gte: (col: string, val: unknown) => QueryBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  insert: (row: Record<string, unknown>) => QueryBuilder;
  upsert: (
    row: Record<string, unknown>,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => QueryBuilder;
  update: (patch: Record<string, unknown>) => QueryBuilder;
  delete: () => QueryBuilder;
  then: (
    onfulfilled?: (v: { data: unknown; error: unknown }) => unknown,
    onrejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
}

function makeQuery(state: MockState, table: string): QueryBuilder {
  const filters: Filter[] = [];
  let orderCol: string | null = null;
  let ascending = true;
  let limit: number | null = null;
  let mode: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
  let patch: Record<string, unknown> = {};
  let toInsert: Record<string, unknown> | null = null;
  let upsertConflictCols: string[] = [];
  let upsertIgnoreDuplicates = false;
  let countMode: 'exact' | null = null;
  let headMode = false;

  const execute = async (): Promise<{ data: unknown; error: unknown; count?: number }> => {
    const tableRows = state.rows[table] ?? [];

    if (mode === 'insert') {
      if (toInsert) {
        const constraint = state.insertConstraints?.[table];
        if (constraint) {
          const newVal = toInsert[constraint.column];
          const exists = tableRows.some(
            (row) => row[constraint.column] === newVal,
          );
          if (exists) {
            return {
              data: null,
              error: {
                code: '23505',
                message: `duplicate key value violates unique constraint on "${table}"`,
              },
            };
          }
        }
        state.inserts.push({ table, row: toInsert });
        if (state.rows[table]) {
          state.rows[table].push(toInsert);
        } else {
          state.rows[table] = [toInsert];
        }
        return { data: toInsert, error: null };
      }
      return { data: null, error: null };
    }

    if (mode === 'upsert') {
      // Models `INSERT ... ON CONFLICT (cols) DO NOTHING` when
      // ignoreDuplicates is set (the idempotency RESERVE path). Returns the
      // inserted row in a one-element array on a win, or an empty array when
      // the conflict target already exists (reservation lost).
      if (!toInsert) {
        return { data: [], error: null };
      }
      const conflict = upsertConflictCols.length > 0 ? upsertConflictCols : [];
      const exists =
        conflict.length > 0 &&
        tableRows.some((row) =>
          conflict.every((col) => row[col] === (toInsert as Record<string, unknown>)[col]),
        );
      if (exists) {
        if (upsertIgnoreDuplicates) {
          return { data: [], error: null };
        }
        // DO UPDATE style: overwrite the existing conflicting row in place.
        const target = tableRows.find((row) =>
          conflict.every((col) => row[col] === (toInsert as Record<string, unknown>)[col]),
        );
        if (target) Object.assign(target, toInsert);
        return { data: [target], error: null };
      }
      state.inserts.push({ table, row: toInsert });
      if (state.rows[table]) {
        state.rows[table].push(toInsert);
      } else {
        state.rows[table] = [toInsert];
      }
      return { data: [toInsert], error: null };
    }

    if (mode === 'update') {
      state.updates.push({
        table,
        patch,
        filters: filters
          .filter((f) => f.kind === 'eq')
          .map((f) => ({ col: f.col, val: f.val })),
      });
      const matched = applyFilters(tableRows, filters);
      const updated = matched.map((row) => ({ ...row, ...patch }));
      return { data: updated[0] ?? null, error: null };
    }

    if (mode === 'delete') {
      return { data: null, error: null };
    }

    let result = applyFilters(tableRows, filters);
    if (orderCol) {
      const col = orderCol;
      result = [...result].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        if (av < bv) return ascending ? -1 : 1;
        return ascending ? 1 : -1;
      });
    }
    const totalCount = result.length;
    if (limit !== null) result = result.slice(0, limit);
    if (headMode) {
      return { data: null, error: null, count: totalCount };
    }
    if (countMode === 'exact') {
      return { data: result, error: null, count: totalCount };
    }
    return { data: result, error: null };
  };

  // R-W13-FIN-01: after a status-guarded SELECT resolves, advance the stored
  // row's status to the configured sentinel so the handler's follow-up UPDATE
  // (filtered on the now-stale status it just read) matches 0 rows. Only fires
  // for select reads and only while the stored status still differs from the
  // sentinel, so it triggers exactly once per concurrent-race fixture.
  const maybeAdvanceRaceStatus = (): void => {
    if (mode !== 'select') return;
    const sentinel = state.raceAdvanceStatusOnSelect?.[table];
    if (typeof sentinel !== 'string') return;
    const tableRows = state.rows[table] ?? [];
    const matched = applyFilters(tableRows, filters);
    for (const row of matched) {
      if (row.status !== sentinel) row.status = sentinel;
    }
  };

  // For race tables, hand the caller a shallow copy of the row(s) so the
  // status it reads is the pre-advance snapshot even after the stored row is
  // mutated to the sentinel. Returns null (caller uses the live data) for
  // non-race tables so reference semantics are preserved everywhere else.
  const snapshotForRace = (data: unknown): unknown => {
    if (mode !== 'select') return null;
    if (typeof state.raceAdvanceStatusOnSelect?.[table] !== 'string') return null;
    if (Array.isArray(data)) {
      return data.map((row) =>
        row && typeof row === 'object' ? { ...(row as Record<string, unknown>) } : row,
      );
    }
    if (data && typeof data === 'object') {
      return { ...(data as Record<string, unknown>) };
    }
    return data;
  };

  const builder: QueryBuilder = {
    select: (_cols, opts) => {
      if (opts?.count === 'exact') countMode = 'exact';
      if (opts?.head) headMode = true;
      return builder;
    },
    eq: (col, val) => {
      filters.push({ kind: 'eq', col, val });
      return builder;
    },
    is: (col, val) => {
      filters.push({ kind: 'is', col, val });
      return builder;
    },
    in: (col, val) => {
      filters.push({ kind: 'in', col, val });
      return builder;
    },
    gte: (col, val) => {
      filters.push({ kind: 'gte', col, val });
      return builder;
    },
    order: (col, opts) => {
      orderCol = col;
      ascending = opts?.ascending ?? true;
      return builder;
    },
    limit: (n) => {
      limit = n;
      return builder;
    },
    maybeSingle: async () => {
      const r = await execute();
      const snapshot = snapshotForRace(r.data);
      maybeAdvanceRaceStatus();
      const data = snapshot ?? r.data;
      const arr = Array.isArray(data) ? data : null;
      if (arr) return { data: arr[0] ?? null, error: r.error };
      return { data: data ?? null, error: r.error };
    },
    single: async () => {
      const r = await execute();
      const snapshot = snapshotForRace(r.data);
      maybeAdvanceRaceStatus();
      const data = snapshot ?? r.data;
      const arr = Array.isArray(data) ? data : null;
      if (arr) return { data: arr[0] ?? null, error: r.error };
      return { data: data ?? null, error: r.error };
    },
    insert: (row) => {
      mode = 'insert';
      toInsert = row;
      return builder;
    },
    upsert: (row, opts) => {
      mode = 'upsert';
      toInsert = row;
      upsertConflictCols = opts?.onConflict
        ? opts.onConflict.split(',').map((c) => c.trim())
        : [];
      upsertIgnoreDuplicates = opts?.ignoreDuplicates ?? false;
      return builder;
    },
    update: (p) => {
      mode = 'update';
      patch = p;
      return builder;
    },
    delete: () => {
      mode = 'delete';
      return builder;
    },
    then: (onfulfilled, onrejected) => execute().then(onfulfilled, onrejected),
  };

  return builder;
}

export function makeSupabaseMock(state: MockState): {
  from: (table: string) => QueryBuilder;
  rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
  auth: {
    admin: {
      inviteUserByEmail: (
        email: string,
        options?: { redirectTo?: string },
      ) => Promise<MockState['authAdminInviteResult']>;
      generateLink: (params: {
        type: string;
        email: string;
        options?: { redirectTo?: string };
      }) => Promise<MockState['authAdminGenerateLinkResult']>;
      listUsers: (params?: {
        filter?: string;
        perPage?: number;
        page?: number;
      }) => Promise<MockState['authAdminListUsersResult']>;
      updateUserById: (
        id: string,
        attributes: { app_metadata?: Record<string, unknown> },
      ) => Promise<MockState['authAdminUpdateUserByIdResult']>;
      getUserById: (
        id: string,
      ) => Promise<{
        data: {
          user:
            | {
                id: string;
                email: string;
                email_confirmed_at?: string | null;
              }
            | null;
        };
        error: { message: string } | null;
      }>;
    };
  };
} {
  return {
    from: (table) => makeQuery(state, table),
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      return (
        state.rpcResults[name] ?? { data: null, error: null }
      );
    },
    auth: {
      admin: {
        inviteUserByEmail: async (email, options) => {
          state.authAdminInviteCalls.push({ email, options });
          return state.authAdminInviteResult;
        },
        generateLink: async ({ type, email, options }) => {
          state.authAdminGenerateLinkCalls.push({ type, email, options });
          return state.authAdminGenerateLinkResult;
        },
        listUsers: async (params) => {
          state.authAdminListUsersCalls.push({
            filter: params?.filter,
            perPage: params?.perPage,
          });
          return state.authAdminListUsersResult;
        },
        updateUserById: async (id, attributes) => {
          state.authAdminUpdateUserByIdCalls.push({ id, attributes });
          return state.authAdminUpdateUserByIdResult;
        },
        getUserById: async (id) => {
          state.authAdminGetUserByIdCalls.push(id);
          // Per-user override map. Tests that exercise the claimed/unclaimed
          // gate on the staff members list or the resend endpoint can
          // install a richer record (notably email_confirmed_at) keyed by
          // user id. Missing entries fall back to the default echo so other
          // tests stay green.
          const override = state.authAdminGetUserByIdResults[id];
          if (override) return override;
          return {
            data: {
              user: {
                id,
                email: 'mock-user@example.test',
                email_confirmed_at: '2026-01-01T00:00:00Z',
              },
            },
            error: null,
          };
        },
      },
    },
  };
}

// Build a fake JWT carrying the kitstak_org_id/kitstak_org_role claims so
// `requireCaller` resolves a valid caller. The JWT signature is not verified
// inside `_shared/tenant.ts`; the helper only decodes the payload.
export function makeFakeJwt(caller: Caller): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const payload = btoa(
    JSON.stringify({
      sub: caller.userId,
      app_metadata: {
        kitstak_org_id: caller.orgId,
        kitstak_org_role: caller.role,
      },
    }),
  )
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const signature = 'sig';
  return `${header}.${payload}.${signature}`;
}

export function bearer(caller: Caller): string {
  return `Bearer ${makeFakeJwt(caller)}`;
}
