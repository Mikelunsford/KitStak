// Wave 12 / A4. The JobTemplateSnapshotSchema must parse the frozen snapshot
// that migration 0094's convert_quote_to_project writes into
// projects.job_template_snapshot, including the awkward shapes: a priced
// component line, an unpriced step line (rate_cents null), cents on the wire as
// a numeric string, and a snapshot whose optional header fields are absent. It
// must also accept null/undefined at the project field level (the column is
// nullable and additive). The schema is the SPA-side mirror of a server-authored
// blob, so it is deliberately lenient; this test pins the load-bearing fields.

import { describe, expect, it } from 'vitest';

import {
  JobTemplateSnapshotSchema,
  ProjectSchema,
} from '../../src/lib/types/sales';

// A representative snapshot exactly as the migration builds it: header fields
// plus three lines (component priced, service priced, step unpriced).
const SERVER_SNAPSHOT = {
  snapshot_at: '2026-06-13T12:00:00.000Z',
  template_id: '11111111-1111-4111-8111-111111111111',
  template_number: 'JB-0001',
  name: 'Retail Kit',
  variant: 'kit',
  job_type_id: '22222222-2222-4222-8222-222222222222',
  default_bom_item_id: null,
  status: 'active',
  notes: null,
  lines: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      line_kind: 'component',
      item_id: '44444444-4444-4444-8444-444444444444',
      vas_id: null,
      name: 'Widget',
      quantity: 2,
      rate_cents: 500,
      rate_uom: 'each',
      currency_code: 'USD',
      position: 0,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      line_kind: 'service',
      item_id: null,
      vas_id: '66666666-6666-4666-8666-666666666666',
      name: 'Kitting',
      // cents arriving as a numeric string is valid on the wire.
      quantity: '1',
      rate_cents: '1500',
      rate_uom: null,
      currency_code: 'USD',
      position: 1,
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      line_kind: 'step',
      item_id: null,
      vas_id: null,
      name: 'Inspect',
      quantity: null,
      rate_cents: null,
      rate_uom: null,
      currency_code: null,
      position: 2,
    },
  ],
};

describe('JobTemplateSnapshotSchema (A4)', () => {
  it('parses a full server snapshot, preserving priced and unpriced lines', () => {
    const snap = JobTemplateSnapshotSchema.parse(SERVER_SNAPSHOT);
    expect(snap.name).toBe('Retail Kit');
    expect(snap.variant).toBe('kit');
    expect(snap.lines).toHaveLength(3);
    expect(snap.lines[0]?.rate_cents).toBe(500);
    expect(snap.lines[1]?.rate_cents).toBe('1500');
    expect(snap.lines[2]?.rate_cents).toBeNull();
    expect(snap.lines[2]?.line_kind).toBe('step');
  });

  it('parses a snapshot with optional header fields absent', () => {
    const minimal = {
      template_id: '11111111-1111-4111-8111-111111111111',
      name: 'Bare',
      variant: 'custom',
      lines: [],
    };
    const snap = JobTemplateSnapshotSchema.parse(minimal);
    expect(snap.lines).toEqual([]);
    expect(snap.template_number).toBeUndefined();
  });

  it('rejects a snapshot missing the required template_id', () => {
    const bad = { name: 'No id', variant: 'kit', lines: [] };
    expect(JobTemplateSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a project whose snapshot and breadcrumb are null (additive columns)', () => {
    const project = {
      id: '88888888-8888-4888-8888-888888888888',
      org_id: '99999999-9999-4999-8999-999999999999',
      number: 'PRJ-1',
      name: 'Untemplated',
      description: null,
      customer_id: null,
      source_quote_id: null,
      job_type_id: null,
      source_job_template_id: null,
      job_template_snapshot: null,
      state: 'pending',
      pending_at: null,
      ready_to_build_at: null,
      in_production_at: null,
      ready_to_ship_at: null,
      completed_at: null,
      cancelled_at: null,
      start_date: null,
      due_date: null,
      currency_code: 'USD',
      budget_cents: 0,
      notes: null,
      internal_notes: null,
    };
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('accepts a project carrying the breadcrumb and a frozen snapshot', () => {
    const project = {
      id: '88888888-8888-4888-8888-888888888888',
      org_id: '99999999-9999-4999-8999-999999999999',
      number: 'PRJ-2',
      name: 'Templated',
      description: null,
      customer_id: null,
      source_quote_id: null,
      job_type_id: null,
      source_job_template_id: '11111111-1111-4111-8111-111111111111',
      job_template_snapshot: SERVER_SNAPSHOT,
      state: 'pending',
      pending_at: null,
      ready_to_build_at: null,
      in_production_at: null,
      ready_to_ship_at: null,
      completed_at: null,
      cancelled_at: null,
      start_date: null,
      due_date: null,
      currency_code: 'USD',
      budget_cents: 0,
      notes: null,
      internal_notes: null,
    };
    const parsed = ProjectSchema.parse(project);
    expect(parsed.source_job_template_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed.job_template_snapshot?.lines).toHaveLength(3);
  });
});
