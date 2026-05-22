// WorkCard. UX-Q5 dashboard surface.
//
// Renders a single live "what needs your attention" tile on the operator
// dashboard. Three discriminated visual shapes:
//   1. count   — a numeric count + label, linked to a pre-filtered list page
//   2. loading — skeleton placeholder while the dashboard summary loads
//   3. empty   — onboarding card with a `+` mark when every count is zero
//
// Each card is a single link so the entire surface is clickable. Styling
// uses the Kitstak brand tokens (bg-2, line, ink, accent) from
// tailwind.config.js — no hard-coded palette values, no shadcn primitives.
//
// Constitutional notes:
//   - No em dash, double hyphen, or emoji in user-facing copy.
//   - No new dependencies. Tailwind + lucide-react (existing dep).

import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

export interface WorkCardProps {
  count: number;
  label: string;
  to: string;
  loading?: boolean;
}

export interface EmptyWorkCardProps {
  label: string;
  to: string;
  helperText?: string;
}

/**
 * WorkCard renders a single live work-card tile.
 *
 * When `loading` is true, the count area shows a skeleton block instead of
 * a number; the link target is rendered but the tile is visually quiet.
 */
export function WorkCard({ count, label, to, loading = false }: WorkCardProps) {
  return (
    <Link
      to={to}
      className="group block border border-line bg-bg-2 p-6 transition-colors hover:border-accent focus:outline-none focus:border-accent"
      aria-label={`${label}: ${loading ? 'loading' : count}`}
    >
      <div className="flex flex-col gap-3">
        {loading ? (
          <div
            className="h-12 w-20 bg-line/50 animate-pulse"
            aria-hidden="true"
          />
        ) : (
          <p className="font-display text-5xl tracking-wide text-ink leading-none">
            {count}
          </p>
        )}
        <p className="font-sans text-sm text-ink-dim uppercase tracking-wider">
          {label}
        </p>
      </div>
    </Link>
  );
}

/**
 * EmptyWorkCard renders an onboarding tile shown when every work-card count
 * is zero. Same visual footprint as WorkCard but shows a `+` mark instead
 * of a numeric count.
 */
export function EmptyWorkCard({ label, to, helperText }: EmptyWorkCardProps) {
  return (
    <Link
      to={to}
      className="group block border border-line bg-bg-2 p-6 transition-colors hover:border-accent focus:outline-none focus:border-accent"
      aria-label={label}
    >
      <div className="flex flex-col gap-3">
        <div className="flex h-12 w-12 items-center justify-center border border-line bg-bg-3 text-ink-dim group-hover:text-accent group-hover:border-accent">
          <Plus size={28} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="font-sans text-sm text-ink uppercase tracking-wider">
          {label}
        </p>
        {helperText ? (
          <p className="font-sans text-xs text-ink-dim">{helperText}</p>
        ) : null}
      </div>
    </Link>
  );
}
