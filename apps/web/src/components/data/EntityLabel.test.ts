// Tests for the EntityLabel clickable treatment (R-W14-READ-02). EntityLabel's
// leaf components resolve through TanStack Query hooks and the Supabase client,
// so they cannot be imported into this no-jsdom suite. The treatment lives in a
// pure sibling module instead; we lock it here: bold weight as the non-color
// affordance, a hover and focus-visible color cue, and no underline.

import { describe, it, expect } from 'vitest';

import { LINK_CLASS, PLAIN_CLASS } from './entityLabelStyles';

describe('EntityLabel clickable treatment', () => {
  it('renders clickable names bold with hover and focus cues, never underlined', () => {
    expect(LINK_CLASS).toContain('font-semibold');
    expect(LINK_CLASS).toContain('hover:text-accent');
    expect(LINK_CLASS).toContain('focus-visible:outline');
    expect(LINK_CLASS).not.toContain('underline');
  });

  it('renders non-clickable labels at the same bold weight', () => {
    expect(PLAIN_CLASS).toContain('font-semibold');
    expect(PLAIN_CLASS).not.toContain('underline');
  });
});
