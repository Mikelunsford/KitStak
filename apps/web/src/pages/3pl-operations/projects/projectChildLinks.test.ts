// F-Wave9-AUDIT-V3-WAVE-C4-01: unit tests for the project-child URL
// builders consumed by ProjectDetailPage. Locks the route shapes and
// the `?project_id=` query-param shape so the deep-link contract with
// the C3 prefill on the create pages stays stable.

import { describe, expect, it } from 'vitest';

import {
  buildManufacturingRunDetailUrl,
  buildNewManufacturingRunUrl,
  buildNewShipmentUrl,
  buildShipmentDetailUrl,
} from './projectChildLinks';

const PROJECT_ID = '00000000-0000-4000-8000-0000000000a1';
const RUN_ID = '00000000-0000-4000-8000-0000000000b2';
const SHIP_ID = '00000000-0000-4000-8000-0000000000c3';

describe('buildNewManufacturingRunUrl', () => {
  it('routes to /manufacturing/runs/new', () => {
    expect(buildNewManufacturingRunUrl(PROJECT_ID)).toMatch(
      /^\/manufacturing\/runs\/new\?/,
    );
  });

  it('includes project_id as a query param', () => {
    expect(buildNewManufacturingRunUrl(PROJECT_ID)).toContain(
      `project_id=${PROJECT_ID}`,
    );
  });

  it('encodes unusual characters defensively', () => {
    const url = buildNewManufacturingRunUrl('a/b');
    expect(url).toBe('/manufacturing/runs/new?project_id=a%2Fb');
  });
});

describe('buildNewShipmentUrl', () => {
  it('routes to /3pl-operations/shipments/new', () => {
    expect(buildNewShipmentUrl(PROJECT_ID)).toMatch(
      /^\/3pl-operations\/shipments\/new\?/,
    );
  });

  it('includes project_id as a query param', () => {
    expect(buildNewShipmentUrl(PROJECT_ID)).toContain(
      `project_id=${PROJECT_ID}`,
    );
  });

  it('encodes unusual characters defensively', () => {
    const url = buildNewShipmentUrl('a b');
    expect(url).toBe('/3pl-operations/shipments/new?project_id=a%20b');
  });
});

describe('buildManufacturingRunDetailUrl', () => {
  it('routes to /manufacturing/runs/:id', () => {
    expect(buildManufacturingRunDetailUrl(RUN_ID)).toBe(
      `/manufacturing/runs/${RUN_ID}`,
    );
  });
});

describe('buildShipmentDetailUrl', () => {
  it('routes to /3pl-operations/shipments/:id', () => {
    expect(buildShipmentDetailUrl(SHIP_ID)).toBe(
      `/3pl-operations/shipments/${SHIP_ID}`,
    );
  });
});
