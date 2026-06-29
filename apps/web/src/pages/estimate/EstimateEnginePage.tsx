import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { computeEstimate } from '@/lib/estimate/engine';
import {
  useActiveRateCard,
} from '@/lib/hooks/useRateCards';
import {
  useEstimate,
  useCreateEstimate,
  useUpdateEstimate,
  useConvertEstimate,
} from '@/lib/hooks/useEstimates';

import { Stepper, type StepDef } from './controls';
import { ClassifyStep } from './ClassifyStep';
import { PricingStep } from './PricingStep';
import { LineItemsStep } from './LineItemsStep';
import { ResultStep } from './ResultStep';
import { SummaryRail } from './SummaryRail';
import {
  initialState,
  reducer,
  toEstimateInput,
  toEstimateInputs,
  toEngineCard,
  fromEstimate,
  type EngineState,
} from './engineState';
import { addDays, shortDate, VALIDITY_DAYS } from './format';
import type { StepProps } from './stepProps';

const STEPS: ReadonlyArray<StepDef> = [
  { n: 1, label: 'Client & scope' },
  { n: 2, label: 'Production & output' },
  { n: 3, label: 'Pass-throughs & add-ons' },
  { n: 4, label: 'Estimate' },
];

// Standalone Estimate Engine: classify a job, price it from the org rate card,
// pick rate-card pass-throughs, and produce a sendable quote. The rate card is
// the persisted per-org source (rate-cards-api); convert produces a real quote
// through estimates-api (the one quote engine).
export function EstimateEnginePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [error, setError] = useState<string | null>(null);

  const { data: activeCard } = useActiveRateCard();
  const card = useMemo(() => toEngineCard(activeCard?.lines ?? []), [activeCard]);

  // Edit path: seed the wizard once from the saved draft.
  const estimateQuery = useEstimate(id);
  const seeded = useRef(false);
  useEffect(() => {
    if (id && estimateQuery.data && !seeded.current) {
      seeded.current = true;
      dispatch({ type: 'patch', patch: fromEstimate(estimateQuery.data.estimate) });
    }
  }, [id, estimateQuery.data]);

  const result = useMemo(() => computeEstimate(toEstimateInput(state), card), [state, card]);

  const createEstimate = useCreateEstimate();
  const updateEstimate = useUpdateEstimate(id ?? '');
  const convert = useConvertEstimate();
  const converting = createEstimate.isPending || updateEstimate.isPending || convert.isPending;

  const set: StepProps['set'] = (key, value) =>
    dispatch({ type: 'patch', patch: { [key]: value } as Partial<EngineState> });
  const goStep = (n: number) => dispatch({ type: 'patch', patch: { step: n } });

  const today = new Date().toISOString().slice(0, 10);
  const validUntil = shortDate(addDays(today, VALIDITY_DAYS));

  async function handleConvert() {
    setError(null);
    if (!state.customerId) {
      setError('Choose a customer in step 1 before converting.');
      return;
    }
    try {
      const payload = {
        name: state.projectName.trim() || 'Untitled estimate',
        customer_id: state.customerId,
        rate_card_id: activeCard?.rate_card.id ?? null,
        family: state.family,
        engine: state.engine,
        currency_code: 'USD',
        inputs: toEstimateInputs(state),
      };
      let estimateId = id;
      if (estimateId) {
        await updateEstimate.mutateAsync(payload);
      } else {
        const created = await createEstimate.mutateAsync(payload);
        estimateId = created.id;
      }
      const res = await convert.mutateAsync({ id: estimateId });
      navigate(`/quotes/${res.quote_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not convert the estimate to a quote.');
    }
  }

  const stepProps: StepProps = { state, result, card, set, dispatch };
  const progressLabel = state.step === 4 ? 'Estimate ready' : `Step ${state.step} of 4`;

  return (
    <section className="mx-auto max-w-6xl px-8 py-12">
      <PageHeader
        title={id ? 'Edit estimate' : 'Estimate engine'}
        meta={progressLabel}
      />

      <div className="mt-6">
        <Stepper steps={STEPS} current={state.step} onGo={goStep} />

        {state.step < 4 ? (
          <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-6">
              {state.step === 1 ? <ClassifyStep {...stepProps} /> : null}
              {state.step === 2 ? <PricingStep {...stepProps} /> : null}
              {state.step === 3 ? <LineItemsStep {...stepProps} /> : null}

              <div className="mt-1 flex items-center gap-3 border-t border-line pt-5">
                {state.step > 1 ? (
                  <Button variant="secondary" onClick={() => goStep(Math.max(1, state.step - 1))}>
                    Back
                  </Button>
                ) : null}
                <div className="ml-auto">
                  <Button onClick={() => goStep(Math.min(4, state.step + 1))}>
                    {state.step === 3 ? 'Build estimate' : 'Continue'}
                  </Button>
                </div>
              </div>
            </div>

            <SummaryRail state={state} result={result} />
          </div>
        ) : (
          <ResultStep
            state={state}
            result={result}
            validUntil={validUntil}
            customerSelected={Boolean(state.customerId)}
            converting={converting}
            error={error}
            onConvert={handleConvert}
            onEditScope={() => goStep(3)}
          />
        )}
      </div>
    </section>
  );
}
