// ActionTile. Shared navigational tile for pillar-home "work" grids
// (F-Wave10-UI-KIT-01). A bordered surface that links somewhere, with a display
// title and a one-line body. Promoted from the identical local copies that the
// Co-Pack, Manufacturing, and KitForce home pages each defined, so the landing
// surfaces share one tile instead of three drifting duplicates.

import { Link } from 'react-router-dom';

export interface ActionTileProps {
  /** Destination route. */
  to: string;
  /** Display-font tile title. */
  title: string;
  /** One-line supporting copy. */
  body: string;
}

export function ActionTile({ to, title, body }: ActionTileProps) {
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
