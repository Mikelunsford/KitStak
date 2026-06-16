// R-W13-OBS-01: pure property-payload builders for the newer-pillar
// PostHog events. Hooks in useJobRuns / useOps / useWmsPutaway /
// useManufacturing / useKitForce fire these through the existing `track`
// helper on a successful mutation. The payload construction is pure so
// the unit test can lock the shape (and assert no PII) without running
// the full mutation pipeline, mirroring timeToSendInvoice.ts.
//
// Every payload carries opaque UUIDs and FSM status / enum labels only.
// Names, emails, phone numbers, addresses, and money never appear in any
// shape exported here. The shared index signature keeps each builder
// assignable to the `AnalyticsProps = Record<string, AnalyticsPropValue>`
// contract on `track()` while pinning the documented property names.

type ScalarProps = {
  // Index signature to satisfy AnalyticsProps. All values stay scalar
  // (string / number / boolean / null) per the analytics canon.
  [key: string]: string | number | boolean | null;
};

/**
 * Payload for the job_run_transitioned event. Emitted from a 3PL job-run
 * FSM transition (start / complete / close / cancel). The status is the
 * post-transition FSM label returned by the server.
 */
export type JobRunTransitionedProps = ScalarProps & {
  job_run_id: string;
  status: string;
};

export function buildJobRunTransitionedProps(
  jobRunId: string,
  status: string,
): JobRunTransitionedProps {
  return { job_run_id: jobRunId, status };
}

/**
 * Payload for the receiving_received event. Emitted from the WMS
 * receiving-to-dock receive action. `has_dock` reports whether a dock
 * location rode the transition (boolean, never the bin id). `line_count`
 * is the number of received lines, not their contents or amounts.
 */
export type ReceivingReceivedProps = ScalarProps & {
  receiving_order_id: string;
  status: string;
  has_dock: boolean;
  line_count: number;
};

export function buildReceivingReceivedProps(
  receivingOrderId: string,
  status: string,
  hasDock: boolean,
  lineCount: number,
): ReceivingReceivedProps {
  return {
    receiving_order_id: receivingOrderId,
    status,
    has_dock: hasDock,
    line_count: Number.isFinite(lineCount) ? Math.max(0, Math.trunc(lineCount)) : 0,
  };
}

/**
 * Payload for the putaway_transitioned event. Emitted from a WMS putaway
 * FSM transition (start / complete / cancel). The status is the
 * post-transition FSM label returned by the server.
 */
export type PutawayTransitionedProps = ScalarProps & {
  putaway_task_id: string;
  status: string;
};

export function buildPutawayTransitionedProps(
  putawayTaskId: string,
  status: string,
): PutawayTransitionedProps {
  return { putaway_task_id: putawayTaskId, status };
}

/**
 * Payload for the manufacturing_run_transitioned event. Emitted from a
 * manufacturing-run FSM transition (start / complete / cancel). The
 * status is the post-transition FSM label returned by the server.
 */
export type ManufacturingRunTransitionedProps = ScalarProps & {
  manufacturing_run_id: string;
  status: string;
};

export function buildManufacturingRunTransitionedProps(
  manufacturingRunId: string,
  status: string,
): ManufacturingRunTransitionedProps {
  return { manufacturing_run_id: manufacturingRunId, status };
}

/**
 * Payload for the labor_time_clocked event. Emitted from a KitForce
 * time-entry clock-in / clock-out. `action` is the enum label, not a
 * timestamp; the member_id is an opaque UUID, never a name. No hours,
 * minutes, or rate (rate is money and stays out of analytics).
 */
export type LaborTimeClockAction = 'clock_in' | 'clock_out';

export type LaborTimeClockedProps = ScalarProps & {
  time_entry_id: string;
  action: LaborTimeClockAction;
  member_id: string | null;
};

export function buildLaborTimeClockedProps(
  timeEntryId: string,
  action: LaborTimeClockAction,
  memberId: string | null,
): LaborTimeClockedProps {
  return {
    time_entry_id: timeEntryId,
    action,
    member_id: memberId,
  };
}
