// Tests for ColorField. The component is controlled and stateless, so we test
// the pure normalisation helper directly and walk the element tree for the
// rendered controls (no jsdom), matching the components/ui test convention.

import { describe, it, expect } from 'vitest';

import { ColorField, normalizeHexColor } from './ColorField';

interface RNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

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

describe('normalizeHexColor', () => {
  it('passes through a canonical six-digit hex', () => {
    expect(normalizeHexColor('#0a1628')).toBe('#0a1628');
  });

  it('adds the missing leading hash', () => {
    expect(normalizeHexColor('c8102e')).toBe('#c8102e');
  });

  it('expands three-digit shorthand by doubling each nibble', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('f00')).toBe('#ff0000');
  });

  it('lower-cases uppercase input', () => {
    expect(normalizeHexColor('#C8102E')).toBe('#c8102e');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHexColor('  #0a1628  ')).toBe('#0a1628');
  });

  it('returns null for invalid or partial values', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#12')).toBeNull();
    expect(normalizeHexColor('#1234')).toBeNull();
    expect(normalizeHexColor('#1234567')).toBeNull();
    expect(normalizeHexColor('nothex')).toBeNull();
    expect(normalizeHexColor('#zzzzzz')).toBeNull();
  });
});

describe('ColorField', () => {
  it('renders a colour swatch and a hex text input', () => {
    const el = ColorField({ label: 'Primary', name: 'primary', value: '#0a1628', onChange: () => {} });
    const tree = walk(el);
    const inputs = tree.filter((n) => n.type === 'input');
    expect(inputs.some((n) => n.props.type === 'color')).toBe(true);
    expect(inputs.some((n) => n.props.type === 'text')).toBe(true);
  });

  it('feeds the swatch a normalised value and the text field the raw value', () => {
    const el = ColorField({ label: 'Accent', name: 'accent', value: 'c8102e', onChange: () => {} });
    const tree = walk(el);
    const swatch = tree.find((n) => n.type === 'input' && n.props.type === 'color');
    const text = tree.find((n) => n.type === 'input' && n.props.type === 'text');
    expect(swatch?.props.value).toBe('#c8102e');
    expect(text?.props.value).toBe('c8102e');
  });

  it('falls back to a safe swatch value when the hex is partial', () => {
    const el = ColorField({ name: 'x', value: '#12', onChange: () => {} });
    const tree = walk(el);
    const swatch = tree.find((n) => n.type === 'input' && n.props.type === 'color');
    expect(swatch?.props.value).toBe('#000000');
  });

  it('renders the label and an error when provided', () => {
    const el = ColorField({ label: 'Primary', name: 'p', value: '#000000', onChange: () => {}, error: 'Bad colour' });
    const tree = walk(el);
    const strings = tree
      .map((n) => n.props.children)
      .filter((c): c is string => typeof c === 'string');
    expect(strings).toContain('Primary');
    expect(strings).toContain('Bad colour');
  });
});
