// Regression tests for the B4 (Wave B) helper.

import { describe, it, expect } from 'vitest';

import { deriveShipmentCustomerFromProject } from './deriveShipmentCustomerFromProject';

const CUSTOMER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('deriveShipmentCustomerFromProject', () => {
  it('returns null when the project is still loading', () => {
    expect(deriveShipmentCustomerFromProject(undefined, null)).toBeNull();
    expect(deriveShipmentCustomerFromProject(undefined, CUSTOMER_A)).toBeNull();
  });

  it('returns null when the project has no customer_id', () => {
    expect(
      deriveShipmentCustomerFromProject({ id: 'p1', customer_id: null }, null),
    ).toBeNull();
    expect(
      deriveShipmentCustomerFromProject({ id: 'p1' }, null),
    ).toBeNull();
  });

  it('returns null when the project customer already matches the form', () => {
    expect(
      deriveShipmentCustomerFromProject(
        { id: 'p1', customer_id: CUSTOMER_A },
        CUSTOMER_A,
      ),
    ).toBeNull();
  });

  it('returns the project customer when the form is empty', () => {
    expect(
      deriveShipmentCustomerFromProject(
        { id: 'p1', customer_id: CUSTOMER_A },
        null,
      ),
    ).toBe(CUSTOMER_A);
  });

  it('returns the project customer when the form has a different customer (override)', () => {
    // The operator manually picked CUSTOMER_B but then chose a project
    // owned by CUSTOMER_A. The helper proposes the project's customer
    // so the form stays consistent; the caller is free to ignore.
    expect(
      deriveShipmentCustomerFromProject(
        { id: 'p1', customer_id: CUSTOMER_A },
        CUSTOMER_B,
      ),
    ).toBe(CUSTOMER_A);
  });

  it('returns null on empty-string customer_id (defensive)', () => {
    expect(
      deriveShipmentCustomerFromProject(
        { id: 'p1', customer_id: '' },
        null,
      ),
    ).toBeNull();
  });
});
