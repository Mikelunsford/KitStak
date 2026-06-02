// PageHeader. Shared page-title block for operator surfaces (F-Wave10-UI-KIT-01).
//
// Standardizes the header every list and detail page hand-rolled before:
//   eyebrow (mode / breadcrumb)  ->  title  ->  optional meta summary line
//   with right-aligned action slot.
//
// Title casing is normalized to the brand display scale (Bebas Neue, 4xl,
// uppercase, wide tracking) so pages stop drifting between 4xl-uppercase and
// 3xl-sentence-case headings. Presentational only; consumers pass actions
// (typically a Button or a Link-wrapped Button) and meta as nodes.

import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** The page title. Rendered uppercase in the brand display font. */
  title: string;
  /** Small mono eyebrow above the title: mode, breadcrumb, or section. */
  eyebrow?: ReactNode;
  /** One-line summary under the title (counts, context). */
  meta?: ReactNode;
  /** Right-aligned actions (primary CTA, overflow). */
  actions?: ReactNode;
}

export function PageHeader({ title, eyebrow, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-line pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {eyebrow ? (
            <div className="font-mono text-xs uppercase tracking-wider text-ink-dim">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-display text-4xl uppercase tracking-wide text-ink">
            {title}
          </h1>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-3">{actions}</div>
        ) : null}
      </div>
      {meta ? <p className="font-sans text-sm text-ink-dim">{meta}</p> : null}
    </header>
  );
}
