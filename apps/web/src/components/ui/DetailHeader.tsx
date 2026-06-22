// DetailHeader. One shared detail-page header (Workstream B of the 2026-06-17
// UI scan). The scan found every detail page repeated its identity two or
// three times: the customer in the breadcrumb and a "Customer:" subtitle, the
// number in the breadcrumb and the H1, while the human name sat smallest.
//
// This header leads with the human name (resolved by displayTitle on the page)
// and carries the rest of the identity in a single chip row, each fact once:
// the system number as a small mono chip, the status pill, the customer as a
// link, and the headline money. Related links (project, source quote, template)
// sit on a quieter second row so navigation is not lost.
//
// Visual style mirrors PageHeader (same border, display H1, mono eyebrow) so
// the two read as one system. Standalone (does not wrap PageHeader) so the chip
// rows can be real block rows rather than nodes crammed into PageHeader's single
// <p> meta slot. Presentational only: the page owns data, the displayTitle call,
// and the flag gate that chooses this header over the legacy PageHeader.
//
// Status guidance: pages with a StateStepper above them already show the
// current state, so they pass no `status` (the stepper owns it, keeping the
// fact on screen once). Hub pages without a stepper (customer) pass `status`.
//
// Reference-number disclosure (R-W14-READ-04): the system number no longer
// sits in the identity chip row. It moves into an "Additional details"
// Disclosure at the top of the detail body. Because every detail page already
// passes `number` here, the change is inherited with no per-page edit. Pages
// may pass `additionalDetails` to fold a secondary reference (a converted
// project, a source document) into the same disclosure.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Disclosure } from './Disclosure';
import { StatusBadge } from './StatusBadge';

export interface DetailHeaderLink {
  /** Visible link text. */
  label: string;
  /** Router destination. */
  to: string;
  /** Optional test id passed through to the anchor. */
  testId?: string;
}

export interface DetailHeaderMoney {
  /** Money label, e.g. "Total" or "Balance". */
  label: string;
  /** Pre-formatted money string (caller runs formatCents). */
  value: string;
}

export interface DetailHeaderProps {
  /** The human-facing H1, resolved by displayTitle on the page. */
  title: string;
  /**
   * System number. Rendered inside the Additional details disclosure, not in
   * the identity chip row (R-W14-READ-04).
   */
  number?: string | null;
  /**
   * Optional extra content for the Additional details disclosure (a secondary
   * reference such as a converted project or a source document).
   */
  additionalDetails?: ReactNode;
  /** Status string for the pill. Omit on pages that show a StateStepper. */
  status?: string | null;
  /** Customer link chip. Omit when the title already is the customer name. */
  customer?: DetailHeaderLink | null;
  /** Headline money chip (total or balance). */
  money?: DetailHeaderMoney | null;
  /** Quieter second row of related links (project, source quote, template). */
  links?: DetailHeaderLink[];
  /** Right-aligned actions. */
  actions?: ReactNode;
}

export function DetailHeader({
  title,
  number,
  additionalDetails,
  status,
  customer,
  money,
  links,
  actions,
}: DetailHeaderProps) {
  const hasIdentityRow = Boolean(status || customer || money);
  const hasAdditionalDetails = Boolean(number || additionalDetails);
  const relatedLinks = links ?? [];

  return (
    <header className="flex flex-col gap-2 border-b border-line pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-4xl uppercase tracking-wide text-ink">
            {title}
          </h1>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-3">{actions}</div>
        ) : null}
      </div>

      {hasIdentityRow ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-sm text-ink-dim">
          {status ? <StatusBadge status={status} /> : null}
          {customer ? (
            <Link
              to={customer.to}
              className="text-ink hover:text-accent"
              data-testid={customer.testId}
            >
              {customer.label}
            </Link>
          ) : null}
          {money ? (
            <span>
              {money.label}{' '}
              <span className="tabular-nums text-ink">{money.value}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {relatedLinks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-ink-dim">
          {relatedLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-ink-dim hover:text-accent"
              data-testid={link.testId}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}

      {hasAdditionalDetails ? (
        <Disclosure label="Additional details">
          <dl className="flex flex-col gap-1 font-sans text-sm text-ink-dim">
            {number ? (
              <div className="flex gap-2">
                <dt className="font-mono text-xs uppercase tracking-wide text-ink-dim">
                  Reference
                </dt>
                <dd className="tabular-nums text-ink" data-testid="detail-reference-number">
                  {number}
                </dd>
              </div>
            ) : null}
            {additionalDetails}
          </dl>
        </Disclosure>
      ) : null}
    </header>
  );
}
