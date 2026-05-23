// F-Wave9-AUDIT-V3-WAVE-F-01: unit tests for FormGrid's className
// contract. The SPA test suite is node-only (no jsdom) so we call the
// component as a function and inspect the returned React element's
// className prop directly — that is the public contract Tailwind's JIT
// scanner relies on at build time.

import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';

import { FormGrid } from './FormGrid';

// Call signature for FormGrid as a plain function: it returns a
// ReactElement whose `props.className` carries the resolved grid
// classes. The Tailwind JIT scans these string literals at build time
// so the responsive prefix shape (`md:grid-cols-2`, `lg:grid-cols-3`)
// is the load-bearing contract.

type GridProps = { columns?: 1 | 2 | 3; className?: string; children: null };
const Grid = FormGrid as unknown as (props: GridProps) => ReactElement<{
  className: string;
}>;
type FullProps = { className?: string; children: null };
const Full = FormGrid.Full as unknown as (props: FullProps) => ReactElement<{
  className: string;
}>;

describe('FormGrid className contract', () => {
  it('emits 2-column grid classes by default', () => {
    const rendered = Grid({ children: null });
    expect(rendered.props.className).toContain('grid');
    expect(rendered.props.className).toContain('grid-cols-1');
    expect(rendered.props.className).toContain('md:grid-cols-2');
  });

  it('emits 1-column classes when columns=1', () => {
    const rendered = Grid({ columns: 1, children: null });
    expect(rendered.props.className).toContain('grid-cols-1');
    expect(rendered.props.className).not.toContain('md:grid-cols-2');
  });

  it('emits 3-column classes at lg breakpoint when columns=3', () => {
    const rendered = Grid({ columns: 3, children: null });
    expect(rendered.props.className).toContain('md:grid-cols-2');
    expect(rendered.props.className).toContain('lg:grid-cols-3');
  });

  it('appends caller-supplied className without dropping the grid classes', () => {
    const rendered = Grid({
      className: 'mt-4 custom-form',
      children: null,
    });
    expect(rendered.props.className).toContain('grid-cols-1');
    expect(rendered.props.className).toContain('mt-4');
    expect(rendered.props.className).toContain('custom-form');
  });
});

describe('FormGrid.Full className contract', () => {
  it('spans every column at md and up', () => {
    const rendered = Full({ children: null });
    expect(rendered.props.className).toContain('md:col-span-full');
  });
});
