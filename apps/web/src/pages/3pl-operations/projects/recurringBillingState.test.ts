import { describe, expect, it } from 'vitest';

import { resolveRecurringBillingState } from './recurringBillingState';
import type { RecurringSchedule } from '@/lib/types/finance';

function mk(over: Partial<RecurringSchedule>): RecurringSchedule {
  return {
    id: 's1',
    org_id: 'o1',
    project_id: 'p1',
    cadence: 'monthly',
    next_run_on: '2026-07-01',
    status: 'active',
    last_run_on: null,
    last_invoice_id: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  } as RecurringSchedule;
}

describe('resolveRecurringBillingState', () => {
  it('returns none for an empty list', () => {
    expect(resolveRecurringBillingState([])).toEqual({ mode: 'none', schedule: null });
  });

  it('ignores ended schedules', () => {
    const r = resolveRecurringBillingState([mk({ status: 'ended' })]);
    expect(r.mode).toBe('none');
    expect(r.schedule).toBeNull();
  });

  it('reports active for a live active schedule', () => {
    const s = mk({ id: 'live', status: 'active' });
    const r = resolveRecurringBillingState([s]);
    expect(r.mode).toBe('active');
    expect(r.schedule?.id).toBe('live');
  });

  it('reports paused for a live paused schedule', () => {
    const r = resolveRecurringBillingState([mk({ status: 'paused' })]);
    expect(r.mode).toBe('paused');
  });

  it('prefers the most recently created live schedule', () => {
    const older = mk({ id: 'old', status: 'paused', created_at: '2026-06-01T00:00:00Z' });
    const newer = mk({ id: 'new', status: 'active', created_at: '2026-06-10T00:00:00Z' });
    const r = resolveRecurringBillingState([older, newer]);
    expect(r.schedule?.id).toBe('new');
    expect(r.mode).toBe('active');
  });

  it('ignores an ended schedule even when it is the newest row', () => {
    const active = mk({ id: 'a', status: 'active', created_at: '2026-06-01T00:00:00Z' });
    const endedNewer = mk({ id: 'e', status: 'ended', created_at: '2026-06-20T00:00:00Z' });
    const r = resolveRecurringBillingState([active, endedNewer]);
    expect(r.schedule?.id).toBe('a');
    expect(r.mode).toBe('active');
  });
});
