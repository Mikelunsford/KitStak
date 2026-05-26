// SetupChecklist. Dashboard onboarding surface for new orgs.
//
// Renders the canonical 7-step setup checklist derived from the dashboard
// summary's setup-step booleans (added by migration 0064 follow-up; see
// `_shared/types/cross_cutting.ts` DashboardSummarySchema). Each step is
// a row with an icon (complete or pending), an imperative label, helper
// copy, and an arrow CTA that deep-links to the step's create or list
// page. Completed steps show a CheckCircle2 + line-through label and drop
// the CTA. The header carries the progress counter and a thin progress bar
// in the brand accent color.
//
// Visual family: matches WorkCard (PR #107) and ListEmptyState (PR #108)
// for surface tokens (bg-2 + line border, accent on hover and progress
// fill, font-display for tracking-wide section labels). All brand tokens,
// no em dashes, no emojis. The DashboardPage decides whether to render
// this component at all via `isSetupComplete(summary)`; once every step
// is complete the work-card grid takes the top of the dashboard.

import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';

import {
  type SetupStepSpec,
  SETUP_STEPS_TOTAL,
} from '@/pages/dashboardChecklistSteps';

export interface SetupChecklistProps {
  /** Ordered list of setup steps; build via `buildSetupSteps(summary)`. */
  steps: SetupStepSpec[];
  /** Count of complete steps; build via `countCompletedSetupSteps(summary)`. */
  completed: number;
}

export function SetupChecklist({ steps, completed }: SetupChecklistProps) {
  const progressPct = Math.round((completed / SETUP_STEPS_TOTAL) * 100);

  return (
    <section
      className="flex flex-col gap-4"
      data-testid="setup-checklist"
      aria-label={`Setup progress: ${completed} of ${SETUP_STEPS_TOTAL} complete`}
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-wide text-ink-dim">
            GET STARTED
          </h2>
          <p
            className="font-sans text-sm uppercase tracking-wide text-ink-dim"
            data-testid="setup-checklist-progress-counter"
          >
            {completed} of {SETUP_STEPS_TOTAL} complete
          </p>
        </div>
        <div
          className="h-1 w-full bg-ink-faint/40"
          aria-hidden="true"
          data-testid="setup-checklist-progress-track"
        >
          <div
            className="h-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
            data-testid="setup-checklist-progress-fill"
            data-progress={progressPct}
          />
        </div>
      </header>

      <ol className="flex flex-col border border-line bg-bg-2 divide-y divide-line">
        {steps.map((step, index) => (
          <SetupChecklistRow
            key={step.key}
            step={step}
            index={index}
          />
        ))}
      </ol>
    </section>
  );
}

interface SetupChecklistRowProps {
  step: SetupStepSpec;
  index: number;
}

function SetupChecklistRow({ step, index }: SetupChecklistRowProps) {
  const Icon = step.isComplete ? CheckCircle2 : Circle;
  const iconClass = step.isComplete ? 'text-accent' : 'text-ink-faint';
  const labelClass = step.isComplete
    ? 'text-ink-dim line-through'
    : 'text-ink';

  // Complete rows render as a static <li>; pending rows wrap the row in a
  // Link so the entire row is clickable on hover. Both shapes match the
  // same height so the progress band reads as a clean stack.
  const inner = (
    <div className="flex items-start gap-4 px-5 py-4">
      <Icon
        size={24}
        strokeWidth={2}
        className={`mt-0.5 shrink-0 ${iconClass}`}
        aria-hidden="true"
        data-testid="setup-checklist-row-icon"
      />
      <div className="flex flex-1 flex-col gap-1">
        <p
          className={`font-sans text-base font-medium ${labelClass}`}
          data-testid="setup-checklist-row-label"
        >
          <span className="mr-2 font-mono text-xs uppercase text-ink-faint">
            Step {index + 1}
          </span>
          {step.label}
        </p>
        <p
          className="font-sans text-sm text-ink-dim"
          data-testid="setup-checklist-row-helper"
        >
          {step.helperCopy}
        </p>
      </div>
      {!step.isComplete && (
        <ArrowRight
          size={20}
          strokeWidth={2}
          className="mt-1 shrink-0 text-ink-dim transition-transform group-hover:translate-x-1 group-hover:text-accent"
          aria-hidden="true"
          data-testid="setup-checklist-row-cta"
        />
      )}
    </div>
  );

  return (
    <li
      data-testid="setup-checklist-row"
      data-key={step.key}
      data-complete={step.isComplete}
      aria-current={step.isComplete ? undefined : 'step'}
    >
      {step.isComplete ? (
        inner
      ) : (
        <Link
          to={step.to}
          className="group block transition-colors hover:bg-bg-3 focus:bg-bg-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={step.label}
        >
          {inner}
        </Link>
      )}
    </li>
  );
}
