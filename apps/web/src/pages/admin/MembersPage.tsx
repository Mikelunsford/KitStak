// /admin/members. Staff invite surface plus the team-members list.
//
// F-Wave9-STAFF-INVITE-CHASSIS-01 shipped the invite half. F-Wave9-STAFF-
// INVITE-MEMBERS-LIST-01 replaces the v1 stub with a real list backed by
// GET /auth-api/members. Two sections stacked:
//
//   TEAM MEMBERS
//     Live table from useOrgMembers(). Columns: Name (display_name fallback
//     to email), Email, Role (role_display_name), Joined (relative). The
//     caller's own row is marked "(you)" in the Name column. Loading and
//     error states match the brand palette; empty state uses the shared
//     ListEmptyState but with canAdd=false (the create flow is the invite
//     section directly below, not a separate Add route).
//
//   INVITE A TEAMMATE
//     Email + role dropdown + Send button. The dropdown offers the five
//     staff roles (org_admin, sales, ops, accounting, viewer) and never
//     surfaces org_owner; see membersInviteForm.ts for the rationale and
//     the backend privilege-escalation guard that mirrors it. The Send
//     button cycles through idle / pending / success / error states; on
//     success the email field clears, the role resets to the default,
//     the members list query invalidates so the new row appears without a
//     manual refresh, and the dashboard summary query invalidates so the
//     SetupChecklist step 8 (team_invited) ticks on the next dashboard
//     visit.
//
// Wraps in <AppShell> via the AdminProtectedRoute guard. Cap-gated at the
// route layer (admin guard); no separate requireCap call here.

import { useState } from 'react';
import { Users, UserPlus, Mail, Send } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useMe } from '@/lib/hooks/useMe';
import { useInviteStaffMember } from '@/lib/hooks/useMembers';
import {
  useOrgMembers,
  useResendOrgMemberInvite,
  useUpdateOrgMember,
} from '@/lib/hooks/useOrgMembers';
import type { OrgMemberRow, StaffRoleCode } from '@/lib/types/identity';
import {
  INVITE_ROLE_OPTIONS,
  DEFAULT_INVITE_ROLE,
  isInviteFormSubmittable,
} from './membersInviteForm';

export function MembersPage() {
  return (
    <section className="px-8 py-10 max-w-4xl mx-auto flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          TEAM
        </h1>
        <p className="font-sans text-sm text-ink-dim max-w-2xl">
          Add staff members to your workspace. Each teammate signs in with
          a magic link sent to their email.
        </p>
      </header>

      <TeamMembersSection />
      <InviteTeammateSection />
    </section>
  );
}

// ---------------------------------------------------------------------------
// TeamMembersSection. Live members list backed by GET /auth-api/members.
// ---------------------------------------------------------------------------

function TeamMembersSection() {
  const me = useMe({ enabled: true });
  const orgId = me.data?.active_org_id ?? null;
  const members = useOrgMembers({ orgId });

  return (
    <section
      className="flex flex-col gap-3"
      data-testid="org-members-list"
    >
      <header className="flex items-center gap-3">
        <Users
          size={24}
          strokeWidth={2}
          className="text-ink-dim"
          aria-hidden="true"
        />
        <h2 className="font-display text-2xl tracking-wide text-ink">
          TEAM MEMBERS
        </h2>
      </header>

      {members.isLoading ? (
        <p
          className="font-sans text-sm text-ink-dim"
          data-testid="org-members-loading"
        >
          Loading members.
        </p>
      ) : members.isError ? (
        <p
          role="alert"
          className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
          data-testid="org-members-error"
        >
          {members.error instanceof Error
            ? members.error.message
            : 'Could not load team members. Refresh the page.'}
        </p>
      ) : !members.data || members.data.length === 0 ? (
        <ListEmptyState
          entity="team member"
          explainer="No teammates yet. Send an invite below to add the first one."
          addLabel="Invite a teammate"
          addTo="#invite-teammate"
          canAdd={false}
        />
      ) : (
        <MembersTable
          rows={members.data}
          callerUserId={me.data?.user_id}
          callerRole={me.data?.active_role ?? null}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MembersTable. Brand-aligned card surface with one row per active member.
// Caller's own row is marked "(you)" in the Name column and is the only row
// without an action menu (a caller cannot deactivate or re-invite themselves).
// ---------------------------------------------------------------------------

interface MembersTableProps {
  rows: OrgMemberRow[];
  callerUserId: string | undefined;
  callerRole: string | null;
}

function MembersTable({ rows, callerUserId, callerRole }: MembersTableProps) {
  return (
    <div
      className="border border-line bg-bg-2 overflow-x-auto"
      data-testid="org-members-table-wrapper"
    >
      <table className="w-full text-left font-sans text-sm">
        <thead>
          <tr className="border-b border-line text-ink-faint">
            <th className="px-5 py-3 font-mono text-xs uppercase tracking-wide">
              Name
            </th>
            <th className="px-5 py-3 font-mono text-xs uppercase tracking-wide">
              Email
            </th>
            <th className="px-5 py-3 font-mono text-xs uppercase tracking-wide">
              Role
            </th>
            <th className="px-5 py-3 font-mono text-xs uppercase tracking-wide">
              Joined
            </th>
            <th className="px-5 py-3 font-mono text-xs uppercase tracking-wide">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelf = row.user_id === callerUserId;
            const nameLabel = row.display_name ?? row.email;
            return (
              <tr
                key={row.user_id}
                className={
                  'border-b border-line last:border-b-0' +
                  (row.is_active ? '' : ' opacity-60')
                }
                data-testid="org-members-row"
                data-user-id={row.user_id}
              >
                <td className="px-5 py-4 align-top text-ink">
                  <span className="truncate">{nameLabel}</span>
                  {isSelf ? (
                    <span
                      className="ml-2 font-mono text-xs uppercase text-ink-faint"
                      data-testid="org-members-row-self-marker"
                    >
                      (you)
                    </span>
                  ) : null}
                  {!row.is_active ? (
                    <span
                      className="ml-2 font-mono text-xs uppercase text-ink-faint"
                      data-testid="org-members-row-inactive-marker"
                    >
                      (deactivated)
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4 align-top text-ink-dim">
                  <span className="truncate">{row.email}</span>
                </td>
                <td className="px-5 py-4 align-top">
                  <span className="font-mono text-xs uppercase tracking-wide text-ink-dim border border-line px-2 py-1">
                    {row.role_display_name}
                  </span>
                </td>
                <td className="px-5 py-4 align-top text-ink-dim">
                  <RelativeTime value={row.created_at} />
                </td>
                <td className="px-5 py-4 align-top">
                  {isSelf ? (
                    <span className="font-sans text-xs text-ink-faint">
                      No actions on your own row.
                    </span>
                  ) : (
                    <MemberRowActions row={row} callerRole={callerRole} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberRowActions. Per-row controls: change role, deactivate or reactivate,
// and resend (only on rows that have not yet claimed the magic link). Hidden
// on the caller's own row at the table level.
//
// Role options come from INVITE_ROLE_OPTIONS (the five non-owner staff
// codes). org_owner is only surfaced when the caller is themselves an
// org_owner; an org_admin cannot mint another owner per the backend
// FORBIDDEN_ROLE_ESCALATION guard, and hiding the option prevents a confusing
// 403 error path.
//
// Inline feedback mirrors the InviteTeammateSection pattern: success and
// error chips render under the controls with the brand palette. The
// destructive deactivate confirms via window.confirm — chassis-light by
// design; a full modal is deferred to follow-up if operators ask for it.
// ---------------------------------------------------------------------------

interface MemberRowActionsProps {
  row: OrgMemberRow;
  callerRole: string | null;
}

function MemberRowActions({ row, callerRole }: MemberRowActionsProps) {
  const update = useUpdateOrgMember(row.user_id);
  const resend = useResendOrgMemberInvite(row.user_id);
  const [pendingRole, setPendingRole] = useState<StaffRoleCode>(
    row.role_code as StaffRoleCode,
  );

  const isOwnerCaller = callerRole === 'org_owner';
  // Owners see every staff role including the org_owner option (so they can
  // promote another member). Admins see the five non-owner roles only.
  const roleOptions = isOwnerCaller
    ? [{ value: 'org_owner' as StaffRoleCode, label: 'Owner' }, ...INVITE_ROLE_OPTIONS]
    : INVITE_ROLE_OPTIONS;

  function handleRoleChange(next: StaffRoleCode) {
    setPendingRole(next);
    if (next === row.role_code) return;
    update.mutate({ role: next });
  }

  function handleDeactivate() {
    const confirmed = window.confirm(
      `Deactivate ${row.display_name ?? row.email}? They will lose access immediately. You can reactivate them later.`,
    );
    if (!confirmed) return;
    update.mutate({ is_active: false });
  }

  function handleReactivate() {
    update.mutate({ is_active: true });
  }

  function handleResend() {
    resend.mutate();
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="member-row-actions"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Role</span>
          <select
            value={pendingRole}
            onChange={(e) => handleRoleChange(e.target.value as StaffRoleCode)}
            disabled={update.isPending}
            className="bg-bg-2 border border-line text-ink px-2 py-1 font-sans text-xs focus:outline-none focus:border-accent"
            data-testid="member-row-role-select"
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {row.is_active ? (
          <Button
            onClick={handleDeactivate}
            disabled={update.isPending}
            data-testid="member-row-deactivate-button"
          >
            {update.isPending ? 'Working...' : 'Deactivate'}
          </Button>
        ) : (
          <Button
            onClick={handleReactivate}
            disabled={update.isPending}
            data-testid="member-row-reactivate-button"
          >
            {update.isPending ? 'Working...' : 'Reactivate'}
          </Button>
        )}

        {!row.claimed ? (
          <Button
            onClick={handleResend}
            disabled={resend.isPending}
            data-testid="member-row-resend-button"
          >
            <Send
              size={14}
              strokeWidth={2}
              className="mr-1 inline"
              aria-hidden="true"
            />
            {resend.isPending ? 'Sending...' : 'Resend invite'}
          </Button>
        ) : null}
      </div>

      {update.isSuccess ? (
        <p
          role="status"
          className="font-sans text-xs text-success"
          data-testid="member-row-update-success"
        >
          Saved.
        </p>
      ) : null}
      {update.isError ? (
        <p
          role="alert"
          className="font-sans text-xs text-accent"
          data-testid="member-row-update-error"
        >
          {update.error instanceof Error
            ? update.error.message
            : 'Could not save.'}
        </p>
      ) : null}
      {resend.isSuccess ? (
        <p
          role="status"
          className="font-sans text-xs text-success"
          data-testid="member-row-resend-success"
        >
          Invite resent.
        </p>
      ) : null}
      {resend.isError ? (
        <p
          role="alert"
          className="font-sans text-xs text-accent"
          data-testid="member-row-resend-error"
        >
          {resend.error instanceof Error
            ? resend.error.message
            : 'Could not resend.'}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InviteTeammateSection. Email + role + Send. Mirrors the customer
// invite-to-portal section's UX on CustomerDetailPage.
// ---------------------------------------------------------------------------

function InviteTeammateSection() {
  const invite = useInviteStaffMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRoleCode>(DEFAULT_INVITE_ROLE);

  const canSubmit = isInviteFormSubmittable({
    email,
    role,
    isPending: invite.isPending,
  });

  function handleSubmit() {
    if (!canSubmit) return;
    invite.mutate(
      { email: email.trim(), role },
      {
        onSuccess: () => {
          setEmail('');
          setRole(DEFAULT_INVITE_ROLE);
        },
      },
    );
  }

  const buttonLabel = invite.isPending ? 'Sending...' : 'Send invite';

  return (
    <section
      id="invite-teammate"
      className="border border-line bg-bg-2 p-5 flex flex-col gap-4"
      data-testid="invite-teammate-section"
    >
      <header className="flex items-center gap-3">
        <UserPlus
          size={24}
          strokeWidth={2}
          className="text-ink-dim"
          aria-hidden="true"
        />
        <h2 className="font-display text-2xl tracking-wide text-ink">
          INVITE A TEAMMATE
        </h2>
      </header>
      <p className="font-sans text-sm text-ink-dim">
        Send a magic-link invite. The recipient creates their own password
        on first sign-in and lands in your workspace with the role you
        choose.
      </p>

      <TextInput
        label="Email"
        name="invite_email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        required
        placeholder="teammate@example.com"
        autoComplete="off"
      />

      <label className="flex flex-col gap-2" htmlFor="invite_role">
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          Role
        </span>
        <select
          id="invite_role"
          name="invite_role"
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRoleCode)}
          required
          className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          data-testid="invite-role-select"
        >
          {INVITE_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="invite-send-button"
        >
          {buttonLabel}
        </Button>
      </div>

      {invite.isSuccess ? (
        <p
          role="status"
          className="font-sans text-sm text-success border-l-2 border-success pl-3 py-2 bg-success/5 flex items-start gap-2"
          data-testid="invite-success-card"
        >
          <Mail
            size={16}
            strokeWidth={2}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Invitation sent to {invite.data.email}. They will receive a
            magic link by email in the next few minutes.
          </span>
        </p>
      ) : null}

      {invite.isError ? (
        <p
          role="alert"
          className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
          data-testid="invite-error-card"
        >
          {invite.error instanceof Error
            ? invite.error.message
            : 'Invite failed.'}
        </p>
      ) : null}
    </section>
  );
}
