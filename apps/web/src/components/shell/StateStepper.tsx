/**
 * StateStepper. Horizontal progress stepper that visualizes an entity's
 * position on its FSM happy-path. Originally display-only (UX-Q7, 2026-05-21).
 *
 * UX-Q7 reopened (UI/UX reconfiguration, 2026-06-16, Pattern D): the stepper now
 * supports an OPTIONAL interactive next step. When the caller passes `onAdvance`,
 * the single immediate-next happy-path step renders as a button that fires
 * `onAdvance(nextState)`. The caller maps that state to the same transition its
 * action buttons already use, so the server stays the authority and no new
 * transition path is introduced. Every other step (past, current, and any
 * further-future step) stays display-only, so the rail never looks like a
 * many-step control surface. With no `onAdvance`, the stepper is display-only
 * exactly as before, so the pages that have not opted in are unchanged.
 *
 * Placement on each FSM-driven detail page: below the breadcrumbs from #110 and
 * above the page <h1> title. The stepper replaces the static state pill on those
 * pages.
 *
 * Visual:
 *   * Past steps     -> filled accent-color dot, line in `ink`
 *   * Current step   -> outlined accent-color dot, label rendered prominently
 *   * Future steps   -> ink-dim dot, ink-dim line, muted label
 *   * Next step (interactive) -> the future-step styling inside a button with a
 *     hover/focus affordance and an "Advance to ..." aria-label
 *   * Off-path final -> separate "off-path" badge to the right of the stepper
 *
 * Mobile: the flex row wraps. On the narrowest viewports the stepper stacks
 * vertically because `flex-wrap` allows steps to wrap to the next line; each step
 * keeps its dot-then-label vertical anchor.
 */

export interface StateStepperStep {
  /** FSM state value, e.g. `'submitted'`. */
  state: string;
  /** Operator-facing label, e.g. `'Sent for approval'`. */
  label: string;
  /** Set true for terminal happy-path states (`completed`, `paid`, etc.). */
  isTerminal?: boolean;
}

export interface StateStepperOffPath {
  /** Off-path terminal FSM state value, e.g. `'cancelled'`. */
  state: string;
  /** Operator-facing label, e.g. `'Cancelled'`. */
  label: string;
}

export interface StateStepperProps {
  /** Forward path through the FSM in order. First entry is the initial state. */
  steps: StateStepperStep[];
  /** Current FSM state value. May be one of `steps[].state` or an off-path. */
  current: string;
  /**
   * When the current state is a terminal off-path state (cancelled, refunded,
   * overdue, etc.), pass it here. The component then renders the regular
   * path muted and surfaces the off-path state as an accent-colored badge to
   * the right of the stepper. If `current` matches one of `steps[].state`,
   * `offPath` is ignored.
   *
   * Explicitly `| undefined` so callers can pass a ternary expression
   * (`isOffPath(...) ? {...} : undefined`) under tsconfig's
   * exactOptionalPropertyTypes flag.
   */
  offPath?: StateStepperOffPath | undefined;
  /**
   * Optional. When supplied, a step before the current index is rendered as
   * `past` (filled accent dot, ink connector) only if its state value also
   * appears in `visitedStates`. Steps before current that are NOT in
   * `visitedStates` are rendered as `skipped`: the canonical path keeps the
   * step visible but the dot, connector, and label stay muted so the
   * operator does not infer a transition that never happened.
   *
   * Closes F-Wave9-COWORK-SMOKE-07: the invoice FSM allows
   * `draft -> sent` directly (skipping `pending`). Without this prop, the
   * stepper coloured PENDING as past even though audit_log only recorded
   * `draft -> sent`.
   *
   * When this prop is omitted, the stepper falls back to its prior linear-
   * traversal behaviour for backward compatibility with consumers that
   * have not yet wired the audit_log read.
   */
  visitedStates?: readonly string[] | undefined;
  /**
   * Optional (Pattern D, UX-Q7 reopened). When supplied, the single immediate
   * next happy-path step (currentIndex + 1) renders as a button that fires
   * `onAdvance(nextState)`. The caller maps the state to the same transition its
   * action buttons use; the server remains the authority. Omit it to keep the
   * stepper display-only. Ignored when the current state is off-path or terminal
   * (no next step to advance to).
   */
  onAdvance?: ((toState: string) => void) | undefined;
  /** When true, the interactive next step is disabled (a transition is in flight). */
  advancePending?: boolean | undefined;
}

export function StateStepper(props: StateStepperProps) {
  const { steps, current, offPath, visitedStates, onAdvance, advancePending } =
    props;

  // Resolve the current index. If the current state is not on the happy path,
  // the index is -1 and we render the whole path as muted plus the off-path
  // badge (if supplied).
  const currentIndex = steps.findIndex((s) => s.state === current);
  const isOffPath = currentIndex === -1;
  const visitedSet = visitedStates ? new Set(visitedStates) : null;

  // Pattern D: the single immediate next happy-path step is interactive when the
  // caller supplied onAdvance and the current state is on-path with a step ahead.
  // nextIndex === -1 means off-path; nextIndex === steps.length means terminal.
  const nextIndex = isOffPath ? -1 : currentIndex + 1;
  const canAdvanceNext =
    onAdvance !== undefined && nextIndex !== -1 && nextIndex < steps.length;

  return (
    <div
      className="flex flex-wrap items-start gap-x-3 gap-y-4"
      data-testid="state-stepper"
      aria-label="Workflow progress"
    >
      <ol
        className="flex flex-wrap items-start gap-x-2 gap-y-3"
        data-testid="state-stepper-list"
      >
        {steps.map((step, index) => {
          const isBeforeCurrent = !isOffPath && index < currentIndex;
          const isCurrent = !isOffPath && index === currentIndex;
          const isLast = index === steps.length - 1;
          // F-Wave9-COWORK-SMOKE-07: when visitedStates is supplied, a step
          // before the current index only counts as "past" if it was actually
          // recorded in audit_log. Steps before current but absent from
          // visitedStates are "skipped" (the FSM transitioned around them,
          // e.g. invoice draft -> sent skipping pending). Skipped steps stay
          // visible on the canonical path but render muted so the operator
          // does not infer a transition the audit_log never recorded.
          let isPast = false;
          let isSkipped = false;
          if (isBeforeCurrent) {
            if (visitedSet === null || visitedSet.has(step.state)) {
              isPast = true;
            } else {
              isSkipped = true;
            }
          }

          // Dot styling per phase. Past uses filled accent; current uses an
          // outlined accent ring with a small inner; future and skipped both
          // use ink-faint so a not-actually-visited step before current does
          // not read as completed.
          let dotClass: string;
          if (isPast) {
            dotClass = 'bg-accent border-2 border-accent';
          } else if (isCurrent) {
            dotClass = 'bg-bg border-2 border-accent ring-2 ring-accent/30';
          } else {
            dotClass = 'bg-bg border-2 border-ink-faint';
          }

          // Connector line between this step and the next. Past steps get an
          // ink-strength line; current, future, and skipped use ink-dim.
          // Hidden after the last step (no segment beyond the terminal node).
          const connectorClass = isPast
            ? 'bg-ink'
            : 'bg-ink-faint';

          // Label posture: current step uses the brand ink + accent emphasis;
          // past steps use a slightly subdued ink; future and skipped stay
          // ink-dim with reduced opacity.
          let labelClass: string;
          if (isCurrent) {
            labelClass = 'text-ink font-medium';
          } else if (isPast) {
            labelClass = 'text-ink-dim';
          } else {
            labelClass = 'text-ink-dim opacity-70';
          }

          let phase: 'past' | 'current' | 'future' | 'skipped';
          if (isCurrent) phase = 'current';
          else if (isPast) phase = 'past';
          else if (isSkipped) phase = 'skipped';
          else phase = 'future';

          return (
            <li
              key={step.state}
              className="flex items-center gap-2"
              data-testid="state-stepper-step"
              data-state={step.state}
              data-phase={phase}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {canAdvanceNext && index === nextIndex ? (
                <button
                  type="button"
                  onClick={() => onAdvance?.(step.state)}
                  disabled={advancePending}
                  aria-label={`Advance to ${step.label}`}
                  data-testid="state-stepper-advance"
                  className="group flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span
                    className={`inline-block h-3 w-3 ${dotClass} group-hover:border-accent`}
                    aria-hidden="true"
                    data-testid="state-stepper-dot"
                  />
                  <span
                    className={`font-sans text-xs uppercase tracking-wide ${labelClass} group-hover:text-ink`}
                    data-testid="state-stepper-label"
                  >
                    {step.label}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 ${dotClass}`}
                    aria-hidden="true"
                    data-testid="state-stepper-dot"
                  />
                  <span
                    className={`font-sans text-xs uppercase tracking-wide ${labelClass}`}
                    data-testid="state-stepper-label"
                  >
                    {step.label}
                  </span>
                </div>
              )}
              {!isLast && (
                <span
                  className={`inline-block h-px w-6 ${connectorClass}`}
                  aria-hidden="true"
                  data-testid="state-stepper-connector"
                />
              )}
            </li>
          );
        })}
      </ol>
      {isOffPath && offPath && (
        <span
          className="inline-flex items-center gap-2 px-3 py-1 border border-accent text-accent font-sans text-xs uppercase tracking-wide"
          data-testid="state-stepper-off-path"
          data-state={offPath.state}
          aria-label={`Current state: ${offPath.label}`}
        >
          <span
            className="inline-block h-2 w-2 bg-accent"
            aria-hidden="true"
          />
          {offPath.label}
        </span>
      )}
    </div>
  );
}
