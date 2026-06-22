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
  /**
   * @deprecated No longer rendered. The "Category / Page" eyebrow was removed
   * as noisy navigation chrome (the global Back button plus section dashboards
   * cover wayfinding now). The prop is kept so existing call sites compile; the
   * dead props can be swept in a follow-up.
   */
  eyebrow?: ReactNode;
  /** One-line summary under the title (counts, context). */
  meta?: ReactNode;
  /** Right-aligned actions (primary CTA, overflow). */
  actions?: ReactNode;
}

export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-line pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
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
