// Pure helpers for the /admin/members invite form.
//
// Kept out of MembersPage.tsx so the role-options list, the default role,
// and the submit-state predicate can be exercised under Vitest without a
// jsdom renderer (matches the repo's no-jsdom convention; see
// dashboardChecklistSteps.ts and sendButtonFeedback.ts).
//
// F-Wave9-STAFF-INVITE-CHASSIS-01: the org_owner role is excluded from
// the dropdown by design. The backend has a privilege-escalation guard
// that refuses an owner-creates-owner invite, but surfacing the option
// even to org_owner callers invites confusion. v1: never offer it.

import type { StaffRoleCode } from '@/lib/types/identity';

export interface StaffRoleOption {
  value: StaffRoleCode;
  label: string;
}

/**
 * The five staff roles the invite form lets an operator pick from. Ordered
 * by typical scope: admin first (most powerful), viewer last (read-only).
 * org_owner is intentionally absent; see file header.
 */
export const INVITE_ROLE_OPTIONS: ReadonlyArray<StaffRoleOption> = [
  { value: 'org_admin', label: 'Admin' },
  { value: 'sales', label: 'Sales' },
  { value: 'ops', label: 'Ops' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'viewer', label: 'Viewer' },
] as const;

/**
 * Default role pre-selected on form mount. Sales is the most common first
 * teammate per the operator persona work; matches the dropdown order so
 * the visual cue (first option) and the bound value agree.
 */
export const DEFAULT_INVITE_ROLE: StaffRoleCode = 'org_admin';

export interface InviteFormSubmittableInput {
  email: string;
  role: StaffRoleCode | '';
  isPending: boolean;
}

/**
 * True when the Send button should be enabled. Pure-function predicate so
 * the page component does not branch on three pieces of state inline.
 *
 * The email check is intentionally a non-empty trim, not a full RFC-5322
 * validation: Zod safeParse on the wire boundary catches malformed emails
 * with the same error envelope as a server-side rejection (one error
 * surface, not two). Lets the operator try a Send and read the inline
 * error message rather than fighting a permanently-disabled button.
 */
export function isInviteFormSubmittable(
  input: InviteFormSubmittableInput,
): boolean {
  if (input.isPending) return false;
  if (!input.email.trim()) return false;
  if (!input.role) return false;
  return true;
}
