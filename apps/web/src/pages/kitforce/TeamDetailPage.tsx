import { useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
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

/**
 * TeamDetailPage. Pillar 4. Shows the team and its membership. Adding a member
 * gates on kitforce.team.member.add; removing gates on
 * kitforce.team.member.remove. The team library row carries no state machine.
 */
export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const teamId = id ?? '';

  const teams = useTeamsList();
  const teamMembers = useTeamMembers(id);
  const allMembers = useMembersList();
  const add = useAddTeamMember(teamId);
  const remove = useRemoveTeamMember(teamId);
  const caps = useVioCapabilities();

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

  if (teams.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
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
    if (!(await destructiveConfirm({
      action: 'Remove this member from the team',
      consequence: 'The member is removed from the team roster. Time entries already recorded are kept.',
    }))) return;
    remove.mutate(removeMemberId);
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Teams', to: '/kitforce/teams' },
          { label: team.name },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">{team.name}</h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {team.is_active ? 'active' : 'inactive'}
        </span>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-display tracking-wide text-ink">MEMBERS</h2>
          {teamMembers.isFetching && !teamMembers.isLoading ? (
            <span className="text-xs text-ink-dim font-sans" aria-live="polite">Updating.</span>
          ) : null}
        </div>

        {canAdd ? (
          <form
            onSubmit={onAdd}
            className="flex flex-wrap gap-4 items-end border border-line bg-bg-2 p-4"
          >
            <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                disabled={allMembers.isLoading}
                className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">Select a member</option>
                {(allMembers.data ?? [])
                  .filter((m) => m.status === 'active' && !alreadyOnTeam.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
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
          <p className="text-ink-dim font-sans text-sm">No members on this team yet.</p>
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
                  <td className="px-4 py-2 text-ink-dim">{tm.role_in_team ?? '·'}</td>
                  <td className="px-4 py-2">
                    {canRemove ? (
                      <button
                        onClick={() => onRemove(tm.member_id)}
                        disabled={remove.isPending}
                        className="text-accent underline text-xs"
                      >
                        Remove
                      </button>
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

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="workforce_team" entityId={id ?? null} />
      </section>
    </section>
  );
}
