import type { Dispatch } from 'react';

import type { EstimateResult } from '@/lib/estimate/engine';
import type { RateCardLine as EngineRateCardLine } from '@/lib/estimate/rateCard';
import type { EngineAction, EngineState } from './engineState';

// Common props threaded to each wizard step. `set` is a typed convenience over
// dispatching a single-field `patch`. `result` is the live engine output for the
// current state, recomputed against the active rate card. `card` is that same
// card (engine shape) so the line-items editor can show per-line rates.
export interface StepProps {
  state: EngineState;
  result: EstimateResult;
  card: ReadonlyArray<EngineRateCardLine>;
  set: <K extends keyof EngineState>(key: K, value: EngineState[K]) => void;
  dispatch: Dispatch<EngineAction>;
}
