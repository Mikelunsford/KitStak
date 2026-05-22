// Component tests for StateStepper (UX-Q7).
//
// Follows the same pure-TS pattern used by Breadcrumbs.test.ts and
// NextStepCTA.test.ts in this repo: vitest runs without jsdom/testing-library,
// so we call the function component directly and walk the returned React
// element tree to lock the constitutional invariants:
//   - the component is display-only (no onClick handlers anywhere)
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

  it('contains NO onClick handlers anywhere in the rendered tree (display-only)', () => {
    // UX-Q7 locked decision: stepper is display-only, not clickable. This
    // test guards against accidentally adding an interaction handler that
    // would change the operator's mental model.
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

  it('renders no <a>, <button>, or <Link> elements (display-only)', () => {
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
});
