// R-W13-UX-03(b) regression: Zod safeParse issues map to per-field form errors,
// and the field component renders that error on the field (not in a banner).
//
// Two layers:
//   1. zodIssuesToFieldErrors keys issues by `issue.path[0]`, first issue wins,
//      and parks empty-path (whole-object) issues under `_form`.
//   2. The shared TextInput renders the `error` prop as a danger-styled line so
//      a mapped field error actually surfaces on the input. Element-tree walk,
//      no jsdom, matching the repo convention (see PageHeader.test.ts).

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ReactElement } from 'react';

import { zodIssuesToFieldErrors } from './zodFieldErrors';
import { TextInput } from '@/components/ui/TextInput';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

// forwardRef components expose a `.render(props, ref)` callable. The public
// ForwardRefExoticComponent type does not surface it, so narrow it here for the
// element-tree walk (no jsdom, matching the repo convention).
type RenderFn = (props: Record<string, unknown>, ref: unknown) => ReactElement;
const renderTextInput = (TextInput as unknown as { render: RenderFn }).render;

function walk(node: unknown): RNode[] {
  if (!node || typeof node !== 'object') return [];
  const el = node as RNode;
  const out: RNode[] = [el];
  const children = el.props?.children;
  if (Array.isArray(children)) {
    children.forEach((c) => out.push(...walk(c)));
  } else if (children) {
    out.push(...walk(children));
  }
  return out;
}

function allStrings(tree: RNode[]): string[] {
  return tree
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === 'string');
}

const Schema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  account_type: z.enum(['asset', 'liability'], {
    message: 'Pick an account type',
  }),
});

describe('zodIssuesToFieldErrors', () => {
  it('maps each failing field to its own message keyed by the field name', () => {
    const parsed = Schema.safeParse({ code: '', name: '', account_type: 'asset' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = zodIssuesToFieldErrors(parsed.error);
    expect(errors.code).toBe('Code is required');
    expect(errors.name).toBe('Name is required');
    expect(errors.account_type).toBeUndefined();
  });

  it('returns an empty map when there are no issues for a given field', () => {
    const parsed = Schema.safeParse({
      code: 'X',
      name: 'Cash',
      account_type: 'asset',
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps the first issue per field when a single field has several', () => {
    const multi = z.object({
      code: z.string().min(3, 'Too short').regex(/^\d+$/, 'Digits only'),
    });
    const parsed = multi.safeParse({ code: 'ab' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = zodIssuesToFieldErrors(parsed.error);
    // First issue in the list wins; the field shows a single line.
    expect(errors.code).toBe('Too short');
  });

  it('parks whole-object refinement issues (empty path) under _form', () => {
    const refined = z
      .object({ a: z.number(), b: z.number() })
      .refine((v) => v.a < v.b, { message: 'a must be less than b' });
    const parsed = refined.safeParse({ a: 5, b: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const errors = zodIssuesToFieldErrors(parsed.error);
    expect(errors._form).toBe('a must be less than b');
  });
});

describe('TextInput renders a field-level error', () => {
  it('shows the mapped Zod message on the field when error is set', () => {
    const parsed = Schema.safeParse({ code: '', name: 'Cash', account_type: 'asset' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const errors = zodIssuesToFieldErrors(parsed.error);

    // forwardRef component: call its render fn with props + a null ref.
    const el = renderTextInput(
      { label: 'Account code', value: '', error: errors.code },
      null,
    );
    const tree = walk(el);
    const strings = allStrings(tree);

    expect(strings).toContain('Code is required');
    // The error must render in a danger-styled span, not silently swallowed.
    const danger = tree.find(
      (n) =>
        n.type === 'span' &&
        typeof n.props.className === 'string' &&
        n.props.className.includes('text-danger'),
    );
    expect(danger).toBeDefined();
    expect(danger?.props.children).toBe('Code is required');
  });

  it('omits the error span when no error is set', () => {
    const el = renderTextInput({ label: 'Account code', value: 'X' }, null);
    const tree = walk(el);
    const danger = tree.find(
      (n) =>
        n.type === 'span' &&
        typeof n.props.className === 'string' &&
        n.props.className.includes('text-danger'),
    );
    expect(danger).toBeUndefined();
  });
});
