import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useManufacturingRunsList } from '@/lib/hooks/useManufacturing';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { ManufacturingRunStatus } from '@/lib/types/vendors_inventory_ops';

/**
 * ManufacturingHomePage. M3 of the Manufacturing deepening plan.
 *
 * Pillar landing for the Manufacturing surface. Orients the operator with a
 * live status breakdown of manufacturing runs and the primary entry points
 * (start a run, build a run from a bill of materials, manage bills of
 * materials). Routings and operations are deferred per the locked plan, so
 * this surface stays focused on runs and their inputs.
 *
 * Gated by plugins.manufacturing at the route layer (requiresPlugin), so orgs
 * without the pillar flag never render it. Action tiles mirror the role
 * policy for button hiding only. The server stays the authority.
 */
const STATUS_CARDS: ReadonlyArray<{
  status: ManufacturingRunStatus;
  label: string;
}> = [
  { status: 'draft', label: 'Draft' },
  { status: 'started', label: 'In production' },
  { status: 'completed', label: 'Completed' },
];

export function ManufacturingHomePage() {
  const runs = useManufacturingRunsList();
  const caps = useVioCapabilities();

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const run of runs.data ?? []) {
      tally[run.status] = (tally[run.status] ?? 0) + 1;
    }
    return tally;
  }, [runs.data]);

  const canCreate = caps.can('manufacturing.run.create');
  const canAddLines = caps.can('manufacturing.run.line_item.create');

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">MANUFACTURING</h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Convert raw materials into finished kits. Track every run from draft to completion.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">RUNS</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATUS_CARDS.map((card) => (
            <Link
              key={card.status}
              to={`/manufacturing/runs?status=${card.status}`}
              className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
            >
              <span className="text-4xl font-display tracking-wide text-ink">
                {runs.isLoading ? '.' : (counts[card.status] ?? 0)}
              </span>
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                {card.label}
              </span>
            </Link>
          ))}
        </div>
        {runs.error ? (
          <p className="font-sans text-sm text-accent">
            {runs.error instanceof Error ? runs.error.message : 'Failed to load manufacturing runs.'}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">START</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionTile
            to="/manufacturing/runs"
            title="ALL RUNS"
            body="Browse, filter, and open every manufacturing run."
          />
          {canCreate ? (
            <ActionTile
              to="/manufacturing/runs/new"
              title="NEW RUN"
              body="Open a blank draft run and add lines by hand."
            />
          ) : null}
          {canCreate && canAddLines ? (
            <ActionTile
              to="/manufacturing/runs/from-bom"
              title="BUILD FROM BOM"
              body="Pick a finished item and scale its bill of materials into a draft run."
            />
          ) : null}
          <ActionTile
            to="/3pl-operations/boms"
            title="BILLS OF MATERIALS"
            body="Define what each finished item is made of."
          />
        </div>
      </div>
    </section>
  );
}

type ActionTileProps = { to: string; title: string; body: string };

function ActionTile({ to, title, body }: ActionTileProps) {
  return (
    <Link
      to={to}
      className="bg-bg-2 border border-line p-6 flex flex-col gap-3 hover:border-accent"
    >
      <h3 className="text-xl font-display tracking-wider text-ink">{title}</h3>
      <p className="font-sans text-ink-dim text-sm">{body}</p>
    </Link>
  );
}
