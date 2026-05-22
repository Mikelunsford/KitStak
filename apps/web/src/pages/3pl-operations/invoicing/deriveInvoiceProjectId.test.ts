// BNEW-9: regression tests for the project pre-fill derivation used by
// InvoiceCreatePage when the upstream caller (shipment CTA) could only
// pass customer_id. Out of scope for this PR: adding a project_id
// column to shipments (tracked as F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01).

import { describe, it, expect } from 'vitest';

import { deriveInvoiceProjectId } from './deriveInvoiceProjectId';

const CUSTOMER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('deriveInvoiceProjectId', () => {
  it('returns null when there is no customer pre-fill', () => {
    expect(deriveInvoiceProjectId([], null)).toBe(null);
    expect(deriveInvoiceProjectId(undefined, null)).toBe(null);
  });

  it('returns null when the projects list is still loading', () => {
    expect(deriveInvoiceProjectId(undefined, CUSTOMER_A)).toBe(null);
  });

  it('returns null when no project matches the customer', () => {
    const projects = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        customer_id: CUSTOMER_B,
        state: 'active',
        updated_at: '2026-05-22T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe(null);
  });

  it('picks the only active matching project', () => {
    const projects = [
      {
        id: 'project-1',
        customer_id: CUSTOMER_A,
        state: 'active',
        updated_at: '2026-05-22T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe('project-1');
  });

  it('picks the most recently updated active project for the customer', () => {
    const projects = [
      {
        id: 'project-older',
        customer_id: CUSTOMER_A,
        state: 'active',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'project-newer',
        customer_id: CUSTOMER_A,
        state: 'planning',
        updated_at: '2026-05-22T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe('project-newer');
  });

  it('excludes terminal states (closed, cancelled)', () => {
    const projects = [
      {
        id: 'project-closed',
        customer_id: CUSTOMER_A,
        state: 'closed',
        updated_at: '2026-05-22T10:00:00Z', // newest, but closed
      },
      {
        id: 'project-cancelled',
        customer_id: CUSTOMER_A,
        state: 'cancelled',
        updated_at: '2026-05-21T10:00:00Z',
      },
      {
        id: 'project-active',
        customer_id: CUSTOMER_A,
        state: 'active',
        updated_at: '2026-05-20T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe('project-active');
  });

  it('falls back to created_at when updated_at is missing', () => {
    const projects = [
      {
        id: 'project-older',
        customer_id: CUSTOMER_A,
        state: 'active',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'project-newer',
        customer_id: CUSTOMER_A,
        state: 'active',
        created_at: '2026-05-22T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe('project-newer');
  });

  it('does not leak across customers (RLS-friendly: pure filter)', () => {
    const projects = [
      {
        id: 'project-B',
        customer_id: CUSTOMER_B,
        state: 'active',
        updated_at: '2026-05-22T10:00:00Z',
      },
    ];
    expect(deriveInvoiceProjectId(projects, CUSTOMER_A)).toBe(null);
  });
});
