import { useState, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { useTeamsList, useUpdateTeam } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkforceTeamPatch } from '@/lib/types/kitforce';

/**
 * TeamEditPage. Pillar 4. F-Wave10-KITFORCE-TEAM-EDIT-01.
 *
 * The team detail page exposed member management but no way to fix the team
 * name, toggle is_active, or update notes. This page mirrors MemberEditPage but
 * for the workforce_teams library row. Teams carry no state machine so there is
 * no status transition concern; is_active is a plain boolean toggle.
 *
 * Capability gate: kitforce.team.write.
 */
export function TeamEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const teamId = id ?? '';

  const teams = useTeamsList();
  const update = useUpdateTeam(teamId);
  const caps = useVioCapabilities();

  const canUpdate = caps.can('kitforce.team.write');

  const team = useMemo(
    () => (teams.data ?? []).find((t) => t.id === teamId),
    [teams.data, teamId],
  );

  // Local edit state; null means "not yet touched, read from loaded row".
  const [name, setName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (teams.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (!team) return <p className="px-8 py-12 text-accent">Team not found.</p>;

  const vName = name ?? team.name;
  const vIsActive = isActive ?? team.is_active;
  const vNotes = notes ?? team.notes ?? '';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canUpdate) return;
    const body: WorkforceTeamPatch = {
      name: vName.trim(),
      is_active: vIsActive,
      notes: vNotes.trim() ? vNotes.trim() : null,
    };
    update.mutate(body, {
      onSuccess: () => navigate(`/kitforce/teams/${teamId}`),
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="KitForce / Teams" title="Edit team" />
      {!canUpdate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to edit teams.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Team name"
          value={vName}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={vIsActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Active</span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={vNotes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {update.error ? (
          <p className="text-accent font-sans text-sm">
            {update.error instanceof Error ? update.error.message : 'Save failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canUpdate || !vName.trim() || update.isPending}>
            {update.isPending ? 'Saving.' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/kitforce/teams/${teamId}`)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
