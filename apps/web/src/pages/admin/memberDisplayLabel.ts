// Pure helper for the /admin/members Name column.
//
// Resolves a member's display label with a defensive fallback chain:
//   1. profiles.display_name (trimmed; ignore blank strings)
//   2. profiles.email (trimmed; ignore blank strings)
//   3. user_id short prefix in the EntityLabel style (`abcdef12...`) so the
//      Name cell never renders an empty string even in the degenerate case
//      where both display_name and email come back blank.
//
// F-Wave9-COWORK-SMOKE-08. The 2026-05-26 Cowork smoke surfaced that the
// Name column rendered the organization's display_name instead of the
// member's own name. Root cause was on the backend (provision_organization
// seeded profiles.display_name = org.display_name); migration 0072 closes
// that side. This helper is the SPA-side defence in depth so even a row
// with a NULL display_name and a missing email still renders a stable,
// recognisable label.
//
// Kept pure (no React, no JSX) so it can be unit-tested without jsdom,
// matching the membersInviteForm.ts / membersInviteForm.test.ts split
// already in this folder.

import type { OrgMemberRow } from '@/lib/types/identity';

/**
 * Minimal shape this helper depends on. Accepting a structural subset
 * keeps test fixtures small and makes the helper reusable from any other
 * surface that ever needs to render a member label.
 */
export interface MemberDisplayInput {
  user_id: string;
  email: string | null | undefined;
  display_name: string | null | undefined;
}

function nonBlank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Returns the human label for a member row. Never returns an empty string.
 *
 * Preference order: display_name -> email -> UUID short prefix.
 */
export function memberDisplayLabel(row: MemberDisplayInput): string {
  const name = nonBlank(row.display_name);
  if (name) return name;
  const email = nonBlank(row.email);
  if (email) return email;
  return `${row.user_id.slice(0, 8)}...`;
}

/**
 * Convenience overload narrowed to the canonical OrgMemberRow shape so
 * MembersPage callers do not need to widen the type at the call site.
 */
export function memberDisplayLabelFromRow(row: OrgMemberRow): string {
  return memberDisplayLabel(row);
}
