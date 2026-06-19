// Component-prop validation tests for FirstSigninWelcomeBanner
// (F-Wave9-INVITE-PASSWORD-PROMPT-01). Mirrors DetailSectionEmptyCoaching
// / ListEmptyState test style: no jsdom or testing-library, render the
// component as a function call, walk the resulting React element tree,
// and assert against the JSX `props` shape. That is enough to lock the
// rendered surface (headline, body, icon, skip button) and the onSkip
// wiring.
//
// Copy-discipline branch enforces the constitutional voice on every
// rendered string: no em dash, no en dash, no double hyphen, no emoji.

import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { KeyRound } from 'lucide-react';

import { FirstSigninWelcomeBanner } from './FirstSigninWelcomeBanner';

type RNode = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  const el = node as RNode;
  const out: RNode[] = [el];
  const children = el.props?.children;
  if (Array.isArray(children)) {
    children.forEach((child) => out.push(...walk(child)));
  } else if (children) {
    out.push(...walk(children));
  }
  return out;
}

function render(onSkip: () => void = () => {}): RNode[] {
  const tree = FirstSigninWelcomeBanner({ onSkip }) as unknown as ReactElement;
  return walk(tree);
}

function find(
  nodes: RNode[],
  predicate: (n: RNode) => boolean,
): RNode | undefined {
  return nodes.find(predicate);
}

describe('FirstSigninWelcomeBanner', () => {
  it('renders the welcome headline', () => {
    const nodes = render();
    const headline = find(
      nodes,
      (n) => n.props['data-testid'] === 'first-signin-welcome-headline',
    );
    expect(headline).toBeDefined();
    expect(headline?.props.children).toBe('Welcome to Kitstak');
  });

  it('renders the welcome body copy explaining the optional skip', () => {
    const nodes = render();
    const body = find(
      nodes,
      (n) => n.props['data-testid'] === 'first-signin-welcome-body',
    );
    expect(body).toBeDefined();
    expect(typeof body?.props.children).toBe('string');
    expect(body?.props.children as string).toContain('Set a password');
    expect(body?.props.children as string).toContain('skip');
  });

  it('renders the KeyRound icon (security-page-on-theme)', () => {
    const nodes = render();
    const icon = find(nodes, (n) => n.type === KeyRound);
    expect(icon).toBeDefined();
  });

  it('renders the Skip for now button with the documented testid', () => {
    const nodes = render();
    const skip = find(
      nodes,
      (n) => n.props['data-testid'] === 'first-signin-skip-button',
    );
    expect(skip).toBeDefined();
    expect(skip?.props.type).toBe('button');
    expect(skip?.props.children).toBe('Skip for now');
  });

  it('fires onSkip when the Skip for now button click handler is invoked', () => {
    const onSkip = vi.fn();
    const nodes = render(onSkip);
    const skip = find(
      nodes,
      (n) => n.props['data-testid'] === 'first-signin-skip-button',
    );
    expect(skip).toBeDefined();
    const handler = skip?.props.onClick as () => void;
    expect(typeof handler).toBe('function');
    handler();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('exposes a stable banner testid on the root section', () => {
    const nodes = render();
    const root = find(
      nodes,
      (n) => n.props['data-testid'] === 'first-signin-welcome-banner',
    );
    expect(root).toBeDefined();
    expect(root?.props['aria-label']).toBe('Welcome to Kitstak');
  });
});

describe('FirstSigninWelcomeBanner copy discipline', () => {
  // Constitutional invariant: no em dash, no en dash, no double hyphen,
  // no emoji in any rendered copy. Locks the brand voice so a future
  // tweak cannot drift into forbidden punctuation or decoration.
  const EM_DASH = /—/;
  const EN_DASH = /–/;
  const DOUBLE_HYPHEN = /--/;
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  function copyStrings(nodes: RNode[]): string[] {
    const strs: string[] = [];
    for (const n of nodes) {
      const c = n.props.children;
      if (typeof c === 'string') strs.push(c);
    }
    return strs;
  }

  it('rejects em dash, en dash, double hyphen, and emoji in rendered copy', () => {
    const nodes = render();
    for (const s of copyStrings(nodes)) {
      expect(s).not.toMatch(EM_DASH);
      expect(s).not.toMatch(EN_DASH);
      expect(s).not.toMatch(DOUBLE_HYPHEN);
      expect(s).not.toMatch(EMOJI);
    }
  });
});
