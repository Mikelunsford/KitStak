// /admin/members. Staff invite surface.
//
// F-Wave9-STAFF-INVITE-CHASSIS-01 (SPA half). Two sections stacked:
//
//   TEAM MEMBERS
//     v1 stub showing the caller's own membership row, derived from /me.
//     The list endpoint is being added in the backend PR; the stub keeps
//     this page out of a dead-end state until then. data-testid hook on
//     the stub container so the follow-up that wires the LIST endpoint
//     can find and replace this surface.
//
//   INVITE A TEAMMATE
//     Email + role dropdown + Send button. The dropdown offers the five
//     staff roles (org_admin, sales, ops, accounting, viewer) and never
//     surfaces org_owner; see membersInviteForm.ts for the rationale and
//     the backend privilege-escalation guard that mirrors it. The Send
//     button cycles through idle / pending / success / error states; on
//     success the email field clears, the role resets to the default,
//     and the dashboard summary query invalidates so the SetupChecklist
//     step 8 (team_invited) ticks on the next dashboard visit.
//
// Wraps in <AppShell> via the AdminProtectedRoute guard. Cap-gated at the
// route layer (admin guard); no separate requireCap call here.

import { useState } from 'react';
import { Users, UserPlus, Mail } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useMe } from '@/lib/hooks/useMe';
import { useInviteStaffMember } from '@/lib/hooks/useMembers';
import type { StaffRoleCode } from '@/lib/types/identity';
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

      <TeamMembersStub />
      <InviteTeammateSection />
    </section>
  );
}

// ---------------------------------------------------------------------------
// TeamMembersStub. v1 list surface backed by /me only. Replaced by a real
// LIST query when the backend ships GET /auth-api/members.
// ---------------------------------------------------------------------------

function TeamMembersStub() {
  const me = useMe({ enabled: true });

  return (
    <section
      className="flex flex-col gap-3"
      data-testid="org-members-list-stub"
    >
      <header className="flex items-center gap-3">
        <Users
          size={24}
          strokeWidth={2}
          className="text-ink-dim"
          aria-hidden="true"
        />
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">
          TEAM MEMBERS
        </h2>
      </header>

      {me.isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading.</p>
      ) : me.isError || !me.data ? (
        <p className="font-sans text-sm text-accent">
          Could not load your membership. Refresh the page.
        </p>
      ) : (
        <ul className="flex flex-col border border-line bg-bg-2 divide-y divide-line">
          <li className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex flex-col gap-1 min-w-0">
              <p className="font-sans text-base font-medium text-ink truncate">
                {me.data.email}
              </p>
              <p className="font-mono text-xs uppercase text-ink-faint">
                You
              </p>
            </div>
            {me.data.active_role ? (
              <span className="font-mono text-xs uppercase tracking-wide text-ink-dim border border-line px-2 py-1">
                {me.data.active_role}
              </span>
            ) : null}
          </li>
        </ul>
      )}

      <p className="font-sans text-xs text-ink-faint">
        Full member list arrives with the backend list endpoint. For now,
        invited teammates appear here after their first sign-in.
      </p>
    </section>
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
