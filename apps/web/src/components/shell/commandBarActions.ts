// F-UIUX-PALETTE-VERBS-01: action verbs for the Cmd/Ctrl-K palette. The palette
// already searches entities; this adds executable verbs ("New quote", "Go to
// period close") so the operator can act, not just navigate to records.
//
// The create verbs reuse the Topbar Create (+) registry (createMenuActions.ts)
// so the two surfaces never drift. A few navigation verbs that are not creates
// are appended. Each verb is gated by a capability (mirrors the server
// requireCap) and an optional plugin flag (mirrors the add-on bundle gate);
// the destination route stays the server authority, so this is a pure
// presentational shortcut to what the caller can both perform and reach.

import type { Capability } from '@/lib/capabilities';
import { CREATE_ACTIONS, type CreateAction } from './createMenuActions';
import type { CommandRow } from './commandBarModel';

export type ActionVerb = CreateAction;

// Navigation verbs beyond the create shortcuts. Kept distinct from CREATE_ACTIONS
// (no duplicate hrefs) so the palette never lists the same destination twice.
const NAV_VERBS: ReadonlyArray<ActionVerb> = [
  {
    label: 'Go to period close',
    href: '/finance/period-close',
    cap: 'period_close.read',
  },
  {
    label: 'Go to chart of accounts',
    href: '/finance/coa',
    cap: 'coa.read',
  },
];

export const ACTION_VERBS: ReadonlyArray<ActionVerb> = [
  ...CREATE_ACTIONS,
  ...NAV_VERBS,
];

/**
 * Filter the verb list to those that match the query AND the caller can both
 * perform (capability held) and reach (plugin entitled), returned as command
 * rows. A blank query returns no verbs, matching the entity path (which only
 * searches once the operator types). An absent flag key is treated as off,
 * the same contract useOrgFlags applies.
 */
export function visibleActionVerbs(
  verbs: ReadonlyArray<ActionVerb>,
  query: string,
  can: (cap: Capability) => boolean,
  flags: Record<string, boolean>,
): CommandRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  return verbs
    .filter(
      (verb) =>
        verb.label.toLowerCase().includes(q) &&
        can(verb.cap) &&
        (verb.plugin === undefined || flags[verb.plugin] === true),
    )
    .map((verb) => ({
      key: `action-${verb.href}`,
      title: verb.label,
      subtitle: 'Action',
      href: verb.href,
    }));
}
