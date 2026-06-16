// R-W13-OBS-01: unit tests for the newer-pillar PostHog event payload
// builders. Each test asserts the documented property shape AND that no
// PII field (name / email / phone / address / money) ever appears in the
// emitted payload. The builders are pure, so the shapes are locked here
// without running the full mutation pipeline; the integration block
// dispatches each event through the real `track` helper (with a stubbed
// PostHog handle) to confirm the call site contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as analytics from '@/lib/analytics';
import {
  buildJobRunTransitionedProps,
  buildReceivingReceivedProps,
  buildPutawayTransitionedProps,
  buildManufacturingRunTransitionedProps,
  buildLaborTimeClockedProps,
} from './pillarAnalytics';

// Property-name denylist. If any builder ever leaks one of these keys the
// PII guard below fails. Kept broad on purpose: name, email, phone,
// address, and any monetary suffix (_cents / amount / rate / total / price).
const PII_KEY_PATTERN =
  /name|email|phone|address|_cents\b|amount|\brate\b|\btotal\b|price|notes/i;

function assertNoPii(props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    expect(key).not.toMatch(PII_KEY_PATTERN);
  }
  // All values must be scalar (string / number / boolean / null). A nested
  // object could smuggle PII past a key-name check.
  for (const value of Object.values(props)) {
    const isScalar =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
    expect(isScalar).toBe(true);
  }
}

describe('pillarAnalytics payload builders', () => {
  it('buildJobRunTransitionedProps returns id + status only', () => {
    const props = buildJobRunTransitionedProps('jr-1', 'in_progress');
    expect(props).toEqual({ job_run_id: 'jr-1', status: 'in_progress' });
    assertNoPii(props);
  });

  it('buildReceivingReceivedProps returns id, status, has_dock, line_count', () => {
    const props = buildReceivingReceivedProps('ro-1', 'received', true, 3);
    expect(props).toEqual({
      receiving_order_id: 'ro-1',
      status: 'received',
      has_dock: true,
      line_count: 3,
    });
    assertNoPii(props);
  });

  it('buildReceivingReceivedProps coerces a non-finite line_count to 0', () => {
    const props = buildReceivingReceivedProps('ro-1', 'received', false, Number.NaN);
    expect(props.line_count).toBe(0);
    expect(props.has_dock).toBe(false);
  });

  it('buildReceivingReceivedProps truncates a fractional line_count', () => {
    const props = buildReceivingReceivedProps('ro-1', 'received', false, 2.9);
    expect(props.line_count).toBe(2);
  });

  it('buildPutawayTransitionedProps returns id + status only', () => {
    const props = buildPutawayTransitionedProps('pt-1', 'done');
    expect(props).toEqual({ putaway_task_id: 'pt-1', status: 'done' });
    assertNoPii(props);
  });

  it('buildManufacturingRunTransitionedProps returns id + status only', () => {
    const props = buildManufacturingRunTransitionedProps('mr-1', 'completed');
    expect(props).toEqual({
      manufacturing_run_id: 'mr-1',
      status: 'completed',
    });
    assertNoPii(props);
  });

  it('buildLaborTimeClockedProps returns id, action, member_id', () => {
    const props = buildLaborTimeClockedProps('te-1', 'clock_in', 'm-1');
    expect(props).toEqual({
      time_entry_id: 'te-1',
      action: 'clock_in',
      member_id: 'm-1',
    });
    assertNoPii(props);
  });

  it('buildLaborTimeClockedProps allows a null member_id (clock_out)', () => {
    const props = buildLaborTimeClockedProps('te-1', 'clock_out', null);
    expect(props.member_id).toBeNull();
    expect(props.action).toBe('clock_out');
    assertNoPii(props);
  });
});

describe('newer-pillar analytics events fire through track() with no PII', () => {
  let captureSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    captureSpy = vi.fn();
    analytics.__setPostHogForTests({
      capture: captureSpy,
      identify: vi.fn(),
      reset: vi.fn(),
      getFeatureFlag: vi.fn(),
      onFeatureFlags: vi.fn(),
    } as unknown as Parameters<typeof analytics.__setPostHogForTests>[0]);
  });
  afterEach(() => {
    analytics.__setPostHogForTests(null);
  });

  it('job_run_transitioned dispatches the documented payload', () => {
    analytics.track(
      'job_run_transitioned',
      buildJobRunTransitionedProps('jr-1', 'completed'),
    );
    expect(captureSpy).toHaveBeenCalledWith('job_run_transitioned', {
      job_run_id: 'jr-1',
      status: 'completed',
    });
  });

  it('receiving_received dispatches the documented payload', () => {
    analytics.track(
      'receiving_received',
      buildReceivingReceivedProps('ro-1', 'received', true, 5),
    );
    expect(captureSpy).toHaveBeenCalledWith('receiving_received', {
      receiving_order_id: 'ro-1',
      status: 'received',
      has_dock: true,
      line_count: 5,
    });
  });

  it('putaway_transitioned dispatches the documented payload', () => {
    analytics.track(
      'putaway_transitioned',
      buildPutawayTransitionedProps('pt-1', 'in_progress'),
    );
    expect(captureSpy).toHaveBeenCalledWith('putaway_transitioned', {
      putaway_task_id: 'pt-1',
      status: 'in_progress',
    });
  });

  it('manufacturing_run_transitioned dispatches the documented payload', () => {
    analytics.track(
      'manufacturing_run_transitioned',
      buildManufacturingRunTransitionedProps('mr-1', 'started'),
    );
    expect(captureSpy).toHaveBeenCalledWith('manufacturing_run_transitioned', {
      manufacturing_run_id: 'mr-1',
      status: 'started',
    });
  });

  it('labor_time_clocked dispatches the documented payload', () => {
    analytics.track(
      'labor_time_clocked',
      buildLaborTimeClockedProps('te-1', 'clock_in', 'm-1'),
    );
    expect(captureSpy).toHaveBeenCalledWith('labor_time_clocked', {
      time_entry_id: 'te-1',
      action: 'clock_in',
      member_id: 'm-1',
    });
  });

  it('every dispatched payload is free of PII keys and is scalar-only', () => {
    const payloads = [
      buildJobRunTransitionedProps('jr-1', 'planned'),
      buildReceivingReceivedProps('ro-1', 'received', false, 1),
      buildPutawayTransitionedProps('pt-1', 'suggested'),
      buildManufacturingRunTransitionedProps('mr-1', 'draft'),
      buildLaborTimeClockedProps('te-1', 'clock_in', 'm-1'),
    ];
    for (const payload of payloads) {
      analytics.track('job_run_transitioned', payload);
    }
    for (const call of captureSpy.mock.calls) {
      const props = call[1] as Record<string, unknown>;
      assertNoPii(props);
    }
  });
});
