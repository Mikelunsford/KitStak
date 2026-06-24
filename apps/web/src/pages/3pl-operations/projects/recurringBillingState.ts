import type { RecurringSchedule } from '@/lib/types/finance';

export type RecurringBillingMode = 'none' | 'active' | 'paused';

export interface RecurringBillingState {
  mode: RecurringBillingMode;
  schedule: RecurringSchedule | null;
}

/**
 * Derive the project's recurring-billing control state from its schedules.
 *
 * A project has at most one live schedule (the edge create guard rejects a
 * second active or paused row), so ended schedules are historical and ignored.
 * If more than one live row somehow exists, the most recently created wins, so
 * the control is deterministic rather than order-dependent.
 */
export function resolveRecurringBillingState(
  schedules: readonly RecurringSchedule[],
): RecurringBillingState {
  const live = schedules
    .filter((s) => s.status === 'active' || s.status === 'paused')
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const schedule = live[0] ?? null;
  if (!schedule) return { mode: 'none', schedule: null };
  return { mode: schedule.status === 'paused' ? 'paused' : 'active', schedule };
}
