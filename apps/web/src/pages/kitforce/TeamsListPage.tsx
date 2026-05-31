import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useTeamsList, useCreateTeam } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkforceTeamCreate } from '@/lib/types/kitforce';

/**
 * TeamsListPage. Pillar 4 surface. Teams are a flat library (no state machine),
 * so create is an inline form rather than a dedicated page. Membership is
 * managed on the team detail page. Writes gate on kitforce.team.write.
 */
export function TeamsListPage() {
  const teams = useTeamsList();
  const create = useCreateTeam();
  const caps = useVioCapabilities();
  const canWrite = caps.can('kitforce.team.write');

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !name.trim()) return;
    const body: WorkforceTeamCreate = { name: name.trim() };
    if (notes.trim()) body.notes = notes.trim();
    create.mutate(body, {
      onSuccess: () => {
        setName('');
        setNotes('');
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-display tracking-wide text-ink">TEAMS</h1>
      </header>

      {canWrite ? (
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <div className="flex-1 min-w-[12rem]">
            <TextInput
              label="Team name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <TextInput
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Saving.' : 'Add team'}
          </Button>
        </form>
      ) : null}
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}

      {teams.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {teams.error ? (
        <p className="text-accent font-sans text-sm">
          {teams.error instanceof Error ? teams.error.message : 'Failed to load teams.'}
        </p>
      ) : null}

      {!teams.isLoading && (teams.data ?? []).length === 0 ? (
        <ListEmptyState
          entity="team"
          explainer="Teams group members into crews, lines, and pick teams so you can schedule and assign work in bulk."
          addLabel="Add team"
          addTo="/kitforce/teams"
          canAdd={false}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Team</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2">Notes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(teams.data ?? []).map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="px-4 py-2">
                  <Link to={`/kitforce/teams/${t.id}`} className="text-ink underline">
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-dim">{t.is_active ? 'Yes' : 'No'}</td>
                <td className="px-4 py-2 text-ink-dim">{t.notes ?? '.'}</td>
                <td className="px-4 py-2">
                  <Link to={`/kitforce/teams/${t.id}`} className="text-ink underline text-xs">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
