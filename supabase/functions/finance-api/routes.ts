// finance-api route table. COA, journal entries, period close.
// Per-route `finance.journal_entries.enabled` gate lives in the journal_entries
// handlers via requireFinanceJeFlag. COA and period_close do not gate on
// the flag; orgs without the JE feature can still maintain a chart and
// close periods (close_period is a documentation requirement).

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  createCoa,
  deleteCoa,
  getCoa,
  listCoa,
  patchCoa,
} from './handlers/coa.ts';
import {
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntry,
  listJournalEntries,
  patchJournalEntry,
  postJournalEntry,
} from './handlers/journal_entries.ts';
import {
  closePeriod,
  listPeriodClose,
  reopenPeriod,
} from './handlers/period_close.ts';

export const routes: Route[] = [
  { method: 'GET', path: '/', handler: () => ok({ ok: true, bundle: 'finance-api' }) },

  // Chart of accounts
  { method: 'GET',    path: '/coa',      handler: listCoa },
  { method: 'POST',   path: '/coa',      handler: createCoa },
  { method: 'GET',    path: '/coa/:id',  handler: getCoa },
  { method: 'PATCH',  path: '/coa/:id',  handler: patchCoa },
  { method: 'DELETE', path: '/coa/:id',  handler: deleteCoa },

  // Journal entries (per-route flag-gated)
  { method: 'GET',    path: '/journal-entries',          handler: listJournalEntries },
  { method: 'POST',   path: '/journal-entries',          handler: createJournalEntry },
  { method: 'GET',    path: '/journal-entries/:id',      handler: getJournalEntry },
  { method: 'PATCH',  path: '/journal-entries/:id',      handler: patchJournalEntry },
  { method: 'DELETE', path: '/journal-entries/:id',      handler: deleteJournalEntry },
  { method: 'POST',   path: '/journal-entries/:id/post', handler: postJournalEntry },

  // Period close
  { method: 'GET',  path: '/period-close',        handler: listPeriodClose },
  { method: 'POST', path: '/period-close/close',  handler: closePeriod },
  { method: 'POST', path: '/period-close/reopen', handler: reopenPeriod },
];
