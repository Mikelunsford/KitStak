import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';

import { Segmented, FieldLabel } from './controls';
import { FAMILY_OPTIONS, FORM_OPTIONS, CHANNEL_OPTIONS, MATERIALS_OPTIONS } from './options';
import type { FamilyKey } from '@/lib/estimate/families';
import type { MaterialsMode } from './engineState';
import type { StepProps } from './stepProps';

// Step 1 - classify the job. Family is the pivotal choice: it sets the pricing
// engine and the default line items downstream. Form / channel / materials are
// descriptive facets. The customer is a real record (the quote needs it to
// convert), chosen through the shared picker.
export function ClassifyStep({ state, set, dispatch }: StepProps) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextInput
          label="Project name"
          value={state.projectName}
          onChange={(e) => set('projectName', e.target.value)}
          placeholder="e.g. Q3 Endcap Program"
        />
      </div>

      <div className="sm:col-span-2">
        <CustomerPicker
          value={state.customerId}
          onChange={(id) => set('customerId', id)}
          label="Customer"
          placeholder="Search customers"
        />
      </div>

      <div className="sm:col-span-2">
        <FieldLabel hint="The kind of work being quoted. This single choice sets the pricing engine and the line items that follow.">
          Job family
        </FieldLabel>
        <Select
          value={state.family}
          onChange={(e) => dispatch({ type: 'family', family: e.target.value as FamilyKey })}
        >
          {FAMILY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <FieldLabel hint="The physical thing you are building or handling - a sidekick display, pallet, or kit.">
          Form
        </FieldLabel>
        <Select value={state.form} onChange={(e) => set('form', e.target.value)}>
          {FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <FieldLabel hint="Where the product ultimately sells or ships - retail, club, grocery, e-commerce.">
          Channel
        </FieldLabel>
        <Select value={state.channel} onChange={(e) => set('channel', e.target.value)}>
          {CHANNEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <TextInput
          label="Targeted ship date"
          type="date"
          value={state.goLive}
          onChange={(e) => set('goLive', e.target.value)}
        />
      </div>

      <div>
        <FieldLabel hint="Who supplies the corrugate, clips, and product. Customer-supplied adds no cost; sourced items pass through at cost plus markup.">
          Materials
        </FieldLabel>
        <Segmented<MaterialsMode>
          value={state.materials}
          options={MATERIALS_OPTIONS}
          onChange={(v) => set('materials', v)}
        />
      </div>
    </div>
  );
}
