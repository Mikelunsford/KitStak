// Component tests for StateStepper (UX-Q7).
//
// Follows the same pure-TS pattern used by Breadcrumbs.test.ts and
// NextStepCTA.test.ts in this repo: vitest runs without jsdom/testing-library,
// so we call the function component directly and walk the returned React
// element tree to lock the constitutional invariants:
//   - the component is display-only by default; interactive only via onAdvance
//   - past / current / future styling is correct
//   - off-path renders the muted path + accent badge
//   - terminal step has no trailing connector
//   - labels are sourced from the steps array, not derived

import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { StateStepper, type StateStepperStep } from './StateStepper';

interface ElementProps {
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
  'data-state'?: string;
  'data-phase'?: string;
  'aria-current'?: string;
  'aria-label'?: string;
  onClick?: unknown;
  to?: unknown;
  role?: string;
  [key: string]: unknown;
}

function elementProps(node: unknown): ElementProps {
  if (isValidElement(node)) {
    return (node as ReactElement<ElementProps>).props;
  }
  return {};
}

function asArray(children: ReactNode | undefined): ReactNode[] {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

/**
 * Walk the tree depth-first and collect every element matching a predicate.
 */
function collectElements(
  node: ReactNode,
  predicate: (el: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps>[] {
  const out: ReactElement<ElementProps>[] = [];
  const walk = (n: ReactNode) => {
    if (!isValidElement(n)) return;
    const el = n as ReactElement<ElementProps>;
    if (predicate(el)) out.push(el);
    asArray(el.props.children).forEach(walk);
  };
  asArray(node).forEach(walk);
  return out;
}

function collectByTestId(
  node: ReactNode,
  testId: string,
): ReactElement<ElementProps>[] {
  return collectElements(node, (el) => el.props['data-testid'] === testId);
}

const QUOTE_STEPS: StateStepperStep[] = [
  { state: 'draft',           label: 'Draft' },
  { state: 'submitted',       label: 'Sent for approval' },
  { state: 'approved',        label: 'Approved' },
  { state: 'project_pending', label: 'Project pending', isTerminal: true },
];

describe('StateStepper (UX-Q7)', () => {
  it('renders an ordered list with one li per step', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'draft' });
    const list = collectByTestId(result, 'state-stepper-list');
    expect(list.length).toBe(1);
    const steps = collectByTestId(result, 'state-stepper-step');
    expect(steps.length).toBe(QUOTE_STEPS.length);
  });

  it('marks the current step with aria-current="step" and data-phase="current"', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'submitted' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const submitted = steps.find((s) => s.props['data-state'] === 'submitted');
    expect(submitted).toBeDefined();
    expect(submitted!.props['aria-current']).toBe('step');
    expect(submitted!.props['data-phase']).toBe('current');
  });

  it('marks steps before the current as data-phase="past"', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'approved' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const past = steps.filter((s) => s.props['data-phase'] === 'past');
    expect(past.map((s) => s.props['data-state'])).toEqual(['draft', 'submitted']);
  });

  it('marks steps after the current as data-phase="future"', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'submitted' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const future = steps.filter((s) => s.props['data-phase'] === 'future');
    expect(future.map((s) => s.props['data-state'])).toEqual([
      'approved',
      'project_pending',
    ]);
  });

  it('terminal step has no trailing connector but every other step does', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'draft' });
    const connectors = collectByTestId(result, 'state-stepper-connector');
    // 4 steps -> 3 connectors (one between each pair).
    expect(connectors.length).toBe(QUOTE_STEPS.length - 1);
  });

  it('sources labels from the steps array (not derived from state value)', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'submitted' });
    const labels = collectByTestId(result, 'state-stepper-label').map((el) =>
      asArray(el.props.children)[0],
    );
    expect(labels).toEqual([
      'Draft',
      'Sent for approval',
      'Approved',
      'Project pending',
    ]);
  });

  it('renders the off-path badge when current is not on the path AND offPath is supplied', () => {
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'cancelled',
      offPath: { state: 'cancelled', label: 'Cancelled' },
    });
    const badges = collectByTestId(result, 'state-stepper-off-path');
    expect(badges.length).toBe(1);
    expect(badges[0]!.props['data-state']).toBe('cancelled');
    expect(badges[0]!.props['aria-label']).toBe('Current state: Cancelled');
  });

  it('renders no off-path badge when current IS on the path even if offPath is supplied', () => {
    // Defensive: if a caller passes offPath redundantly while current is on
    // the path, the stepper should ignore offPath and render the regular UI.
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'draft',
      offPath: { state: 'cancelled', label: 'Cancelled' },
    });
    const badges = collectByTestId(result, 'state-stepper-off-path');
    expect(badges.length).toBe(0);
  });

  it('renders all steps as future/muted when current is off-path', () => {
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'cancelled',
      offPath: { state: 'cancelled', label: 'Cancelled' },
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    // No step should be marked current or past when the entity is off-path.
    expect(steps.every((s) => s.props['data-phase'] === 'future')).toBe(true);
    expect(steps.every((s) => s.props['aria-current'] === undefined)).toBe(true);
  });

  it('is display-only when onAdvance is omitted (no onClick handlers)', () => {
    // UX-Q7 reopened (Pattern D): the stepper is interactive ONLY when the
    // caller passes onAdvance. Without it the rail stays display-only, so the
    // pages that have not opted in are unchanged. This locks that default.
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'submitted',
      offPath: undefined,
    });
    const withOnClick = collectElements(
      result,
      (el) => typeof el.props.onClick === 'function',
    );
    expect(withOnClick.length).toBe(0);
  });

  it('renders no button or link elements when onAdvance is omitted (display-only default)', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'approved' });
    const interactive = collectElements(result, (el) => {
      if (el.type === 'a' || el.type === 'button') return true;
      // Link from react-router-dom would render as a function/object type;
      // we use `to` prop as a heuristic to catch it.
      if (typeof el.props.to !== 'undefined') return true;
      // role="button" is also a smell.
      if (el.props.role === 'button' || el.props.role === 'link') return true;
      return false;
    });
    expect(interactive.length).toBe(0);
  });

  it('current step dot uses the accent-bordered outlined style (not filled)', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'submitted' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const submitted = steps.find((s) => s.props['data-state'] === 'submitted')!;
    const dot = collectByTestId(submitted, 'state-stepper-dot')[0]!;
    const cls = dot.props.className ?? '';
    expect(cls).toContain('border-accent');
    expect(cls).toContain('ring-accent');
    expect(cls).not.toContain('bg-accent');
  });

  it('past step dot is filled with accent', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'approved' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const draft = steps.find((s) => s.props['data-state'] === 'draft')!;
    const dot = collectByTestId(draft, 'state-stepper-dot')[0]!;
    const cls = dot.props.className ?? '';
    expect(cls).toContain('bg-accent');
    expect(cls).toContain('border-accent');
  });

  it('future step dot uses ink-faint (muted)', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'draft' });
    const steps = collectByTestId(result, 'state-stepper-step');
    const future = steps.find((s) => s.props['data-state'] === 'approved')!;
    const dot = collectByTestId(future, 'state-stepper-dot')[0]!;
    const cls = dot.props.className ?? '';
    expect(cls).toContain('border-ink-faint');
  });

  it('exposes a data-testid hook for the whole component (for downstream e2e selectors)', () => {
    const result = StateStepper({ steps: QUOTE_STEPS, current: 'draft' });
    const props = elementProps(result);
    expect(props['data-testid']).toBe('state-stepper');
    expect(props['aria-label']).toBe('Workflow progress');
  });

  // -----------------------------------------------------------------------
  // F-Wave9-COWORK-SMOKE-07: visitedStates feed.
  //
  // Background: the invoice FSM allows draft -> sent directly (skipping
  // pending). Without visitedStates the stepper paints every step before
  // current as past, so PENDING reads as completed even though audit_log
  // only recorded draft -> sent. The fix takes the audit_log to_state set
  // and marks before-current steps that were not actually visited as
  // "skipped" instead of "past".
  // -----------------------------------------------------------------------
  const INVOICE_STEPS: StateStepperStep[] = [
    { state: 'draft',          label: 'Draft' },
    { state: 'pending',        label: 'Pending' },
    { state: 'sent',           label: 'Sent' },
    { state: 'partially_paid', label: 'Partially Paid' },
    { state: 'paid',           label: 'Paid', isTerminal: true },
  ];

  it('marks a before-current step as "skipped" when visitedStates excludes it', () => {
    // Audit log recorded draft -> sent. Pending was skipped.
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'sent',
      visitedStates: ['draft', 'sent'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const pending = steps.find((s) => s.props['data-state'] === 'pending')!;
    expect(pending.props['data-phase']).toBe('skipped');
  });

  it('still marks visited before-current steps as "past" when visitedStates is supplied', () => {
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'sent',
      visitedStates: ['draft', 'sent'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const draft = steps.find((s) => s.props['data-state'] === 'draft')!;
    expect(draft.props['data-phase']).toBe('past');
  });

  it('paid invoice that walked the full chain marks every prior step as past', () => {
    // Walk the canonical happy path end-to-end.
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'paid',
      visitedStates: ['draft', 'pending', 'sent', 'partially_paid', 'paid'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const past = steps.filter((s) => s.props['data-phase'] === 'past');
    expect(past.map((s) => s.props['data-state'])).toEqual([
      'draft',
      'pending',
      'sent',
      'partially_paid',
    ]);
    const current = steps.find((s) => s.props['data-state'] === 'paid')!;
    expect(current.props['data-phase']).toBe('current');
  });

  it('paid invoice that skipped pending and partially_paid marks them as skipped', () => {
    // Common real-world chain: draft -> sent -> paid (paid in full on first
    // receipt). The stepper should NOT paint pending or partially_paid as
    // past because the audit_log will only have draft, sent, paid.
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'paid',
      visitedStates: ['draft', 'sent', 'paid'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const phases = steps.map((s) => ({
      state: s.props['data-state'],
      phase: s.props['data-phase'],
    }));
    expect(phases).toEqual([
      { state: 'draft',          phase: 'past' },
      { state: 'pending',        phase: 'skipped' },
      { state: 'sent',           phase: 'past' },
      { state: 'partially_paid', phase: 'skipped' },
      { state: 'paid',           phase: 'current' },
    ]);
  });

  it('falls back to linear past/current/future when visitedStates is omitted', () => {
    // Backward compatibility: existing detail pages that have not yet wired
    // the audit_log feed keep the prior behaviour. data-phase remains one
    // of past / current / future; no step is "skipped".
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'sent',
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const phases = steps.map((s) => s.props['data-phase']);
    expect(phases).toEqual(['past', 'past', 'current', 'future', 'future']);
  });

  it('skipped step dot uses ink-faint (not the past-accent fill)', () => {
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'sent',
      visitedStates: ['draft', 'sent'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const pending = steps.find((s) => s.props['data-state'] === 'pending')!;
    const dot = collectByTestId(pending, 'state-stepper-dot')[0]!;
    const cls = dot.props.className ?? '';
    expect(cls).toContain('border-ink-faint');
    expect(cls).not.toContain('bg-accent');
  });

  it('skipped step connector uses ink-faint (not the past-ink fill)', () => {
    const result = StateStepper({
      steps: INVOICE_STEPS,
      current: 'sent',
      visitedStates: ['draft', 'sent'],
    });
    const steps = collectByTestId(result, 'state-stepper-step');
    const pending = steps.find((s) => s.props['data-state'] === 'pending')!;
    const connector = collectByTestId(pending, 'state-stepper-connector')[0]!;
    const cls = connector.props.className ?? '';
    expect(cls).toContain('bg-ink-faint');
  });

  // -----------------------------------------------------------------------
  // UX-Q7 reopened (Pattern D): the optional interactive next step.
  // -----------------------------------------------------------------------
  it('renders the immediate next step as a single advance button when onAdvance is supplied', () => {
    const calls: string[] = [];
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'draft',
      onAdvance: (s) => calls.push(s),
    });
    const advances = collectByTestId(result, 'state-stepper-advance');
    expect(advances.length).toBe(1);
    // Exactly one button in the whole tree: current and further-future steps
    // stay display-only.
    const buttons = collectElements(result, (el) => el.type === 'button');
    expect(buttons.length).toBe(1);
    // Clicking fires onAdvance with the NEXT state (submitted), not the current.
    (advances[0]!.props.onClick as () => void)();
    expect(calls).toEqual(['submitted']);
  });

  it('targets the next happy step relative to the current state', () => {
    const calls: string[] = [];
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'approved',
      onAdvance: (s) => calls.push(s),
    });
    const advance = collectByTestId(result, 'state-stepper-advance')[0]!;
    (advance.props.onClick as () => void)();
    expect(calls).toEqual(['project_pending']);
  });

  it('renders no advance button when the current state is off-path', () => {
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'cancelled',
      offPath: { state: 'cancelled', label: 'Cancelled' },
      onAdvance: () => {},
    });
    expect(collectByTestId(result, 'state-stepper-advance').length).toBe(0);
  });

  it('renders no advance button at a terminal current step (no next step)', () => {
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'project_pending',
      onAdvance: () => {},
    });
    expect(collectByTestId(result, 'state-stepper-advance').length).toBe(0);
  });

  it('disables the advance button while advancePending', () => {
    const result = StateStepper({
      steps: QUOTE_STEPS,
      current: 'draft',
      onAdvance: () => {},
      advancePending: true,
    });
    const advance = collectByTestId(result, 'state-stepper-advance')[0]!;
    expect(advance.props.disabled).toBe(true);
  });
});
