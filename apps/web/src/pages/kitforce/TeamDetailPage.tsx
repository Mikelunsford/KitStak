// TeamDetailPage. KitForce pillar. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (with the active/inactive StatusBadge in the
// meta slot and Edit in the actions slot) replaces the hand-rolled header and
// raw status pill. Teams are a hub (no FSM), so this stays single-column with a
// HISTORY section. The member roster stays a hand-rolled table (it has a
// per-row Remove with destructiveConfirm and a coupled add-member form); the
// add-member picker swaps its raw select for the kit Select. The
// useTeamsList().find() lookup, the active-and-not-already-on-team filter, the
// cap gates, and the remove confirm are preserved verbatim.

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TextInput } from '@/components/ui/TextInput';
import {
  useTeamsList,
  useTeamMembers,
  useMembersList,
  useAddTeamMember,
  useRemoveTeamMember,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import type { WorkforceTeamMemberCreate } from '@/lib/types/kitforce';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const teamId = id ?? '';

  const teams = useTeamsList();
  const teamMembers = useTeamMembers(id);
  const allMembers = useMembersList();
  const add = useAddTeamMember(teamId);
  const remove = useRemoveTeamMember(teamId);
  const caps = useVioCapabilities();

  const canUpdate = caps.can('kitforce.team.write');
  const canAdd = caps.can('kitforce.team.member.add');
  const canRemove = caps.can('kitforce.team.member.remove');

  const [memberId, setMemberId] = useState('');
  const [roleInTeam, setRoleInTeam] = useState('');

  const team = useMemo(
    () => (teams.data ?? []).find((t) => t.id === teamId),
    [teams.data, teamId],
  );

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of allMembers.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [allMembers.data]);

  const alreadyOnTeam = useMemo(() => {
    const set = new Set<string>();
    for (const tm of teamMembers.data ?? []) set.add(tm.member_id);
    return set;
  }, [teamMembers.data]);

  if (teams.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (!team) return <p className="px-8 py-12 text-accent">Team not found.</p>;

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!canAdd || !memberId) return;
    const body: WorkforceTeamMemberCreate = { member_id: memberId };
    if (roleInTeam.trim()) body.role_in_team = roleInTeam.trim();
    add.mutate(body, {
      onSuccess: () => {
        setMemberId('');
        setRoleInTeam('');
      },
    });
  }

  async function onRemove(removeMemberId: string) {
    if (
      !(await destructiveConfirm({
        action: 'Remove this member from the team',
        consequence:
          'The member is removed from the team roster. Time entries already recorded are kept.',
      }))
    )
      return;
    remove.mutate(removeMemberId);
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Teams', to: '/kitforce/teams' },
          { label: team.name },
        ]}
      />
      <PageHeader
        eyebrow="KitForce / Teams"
        title={team.name}
        meta={<StatusBadge status={team.is_active ? 'active' : 'inactive'} />}
        actions={
          canUpdate ? (
            <Link to={`/kitforce/teams/${teamId}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          ) : undefined
        }
      />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-display tracking-wide text-ink">MEMBERS</h2>
          {teamMembers.isFetching && !teamMembers.isLoading ? (
            <span className="text-xs text-ink-dim font-sans" aria-live="polite">
              Updating.
            </span>
          ) : null}
        </div>

        {canAdd ? (
          <form
            onSubmit={onAdd}
            className="flex flex-wrap gap-4 items-end border border-line bg-bg-2 p-4"
          >
            <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
                Member
              </span>
              <Select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                disabled={allMembers.isLoading}
              >
                <option value="">Select a member</option>
                {(allMembers.data ?? [])
                  .filter((m) => m.status === 'active' && !alreadyOnTeam.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </Select>
            </label>
            <div className="flex-1 min-w-[10rem]">
              <TextInput
                label="Role in team (optional)"
                value={roleInTeam}
                onChange={(e) => setRoleInTeam(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!memberId || add.isPending}>
              {add.isPending ? 'Saving.' : 'Add member'}
            </Button>
          </form>
        ) : null}
        {add.error ? (
          <p className="text-accent font-sans text-sm">
            {add.error instanceof Error ? add.error.message : 'Add failed.'}
          </p>
        ) : null}

        {teamMembers.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
        {(teamMembers.data ?? []).length === 0 && !teamMembers.isLoading ? (
          <p className="text-ink-dim font-sans text-sm">
            No members on this team yet.
          </p>
        ) : (
          <table className="w-full border border-line text-sm font-sans">
            <thead className="bg-bg-2 text-left text-ink-dim">
              <tr>
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(teamMembers.data ?? []).map((tm) => (
                <tr key={tm.id} className="border-t border-line">
                  <td className="px-4 py-2 text-ink">
                    {memberName[tm.member_id] ?? tm.member_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {tm.role_in_team ?? '·'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canRemove ? (
                      <Button
                        variant="ghost"
                        onClick={() => onRemove(tm.member_id)}
                        disabled={remove.isPending}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {remove.error ? (
          <p className="text-accent font-sans text-sm">
            {remove.error instanceof Error ? remove.error.message : 'Remove failed.'}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
          HISTORY
        </h2>
        <AuditTimeline entityType="workforce_team" entityId={id ?? null} />
      </section>
    </section>
  );
}
