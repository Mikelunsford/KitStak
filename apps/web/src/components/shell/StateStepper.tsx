/**
 * StateStepper. Display-only horizontal progress stepper that visualizes
 * an entity's position on its FSM happy-path. Implements UX-Q7 from the
 * 2026-05-21 UX revision walk.
 *
 * Operator decision (locked at UX-Q7): the stepper is DISPLAY-ONLY. It
 * renders the current step but is NOT clickable. State transitions still
 * happen via the existing buttons (Submit / Approve / Send / etc.) on
 * each detail page. The stepper visualizes progress; the buttons drive
 * transitions. This keeps the mental model clean and avoids accidental
 * navigations through what looks like a control surface.
 *
 * Placement on each FSM-driven detail page: below the breadcrumbs from
 * #110 and above the page <h1> title. The stepper replaces the static
 * state pill (previously rendered as `<span class="...font-mono uppercase">`
 * in the header) entirely on those pages.
 *
 * Visual:
 *   * Past steps     -> filled accent-color dot, line in `ink`
 *   * Current step   -> outlined accent-color dot, label rendered prominently
 *   * Future steps   -> ink-dim dot, ink-dim line, muted label
 *   * Off-path final -> separate "off-path" badge to the right of the stepper
 *
 * Mobile: the flex row wraps. On the narrowest viewports the stepper
 * stacks vertically because `flex-wrap` allows steps to wrap to the next
 * line; each step keeps its dot-then-label vertical anchor.
 *
 * No `onClick`, `Link`, or `role="button"` on any of the step dots or
 * labels. The component is purely informational.
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
}

export function StateStepper(props: StateStepperProps) {
  const { steps, current, offPath } = props;

  // Resolve the current index. If the current state is not on the happy path,
  // the index is -1 and we render the whole path as muted plus the off-path
  // badge (if supplied).
  const currentIndex = steps.findIndex((s) => s.state === current);
  const isOffPath = currentIndex === -1;

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
          const isPast = !isOffPath && index < currentIndex;
          const isCurrent = !isOffPath && index === currentIndex;
          const isLast = index === steps.length - 1;

          // Dot styling per phase. Past uses filled accent; current uses an
          // outlined accent ring with a small inner; future uses ink-dim.
          let dotClass: string;
          if (isPast) {
            dotClass = 'bg-accent border-2 border-accent';
          } else if (isCurrent) {
            dotClass = 'bg-bg border-2 border-accent ring-2 ring-accent/30';
          } else {
            dotClass = 'bg-bg border-2 border-ink-faint';
          }

          // Connector line between this step and the next. Past steps get an
          // ink-strength line; current and future use ink-dim. Hidden after
          // the last step (no segment beyond the terminal node).
          const connectorClass = isPast
            ? 'bg-ink'
            : 'bg-ink-faint';

          // Label posture: current step uses the brand ink + accent emphasis;
          // past steps use a slightly subdued ink; future steps stay ink-dim.
          let labelClass: string;
          if (isCurrent) {
            labelClass = 'text-ink font-medium';
          } else if (isPast) {
            labelClass = 'text-ink-dim';
          } else {
            labelClass = 'text-ink-dim opacity-70';
          }

          return (
            <li
              key={step.state}
              className="flex items-center gap-2"
              data-testid="state-stepper-step"
              data-state={step.state}
              data-phase={isPast ? 'past' : isCurrent ? 'current' : 'future'}
              aria-current={isCurrent ? 'step' : undefined}
            >
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
