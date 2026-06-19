// JobTemplateLines (Wave 12 Phase A2). The builder-lines section on the job
// template detail page: lists the template's component / service / step lines
// and offers add / edit / delete, each gated on the matching
// threepl.job_template.line.* capability. Extracted from JobTemplateDetailPage
// to keep both files focused. Mirrors AccountServiceDefinitions.
//
// A component line references a catalog item (item_id); a service line
// references a value-added service (vas_id); a step line carries neither.
// Money is BIGINT _cents on the wire, entered in whole cents and rendered via
// formatCents. Quantity is numeric.

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';

import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useJobTemplateLines,
  useCreateJobTemplateLine,
  useUpdateJobTemplateLine,
  useDeleteJobTemplateLine,
} from '@/lib/hooks/useJobTemplates';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  JobTemplateLine,
  JobTemplateLineKind,
} from '@/lib/services/jobTemplatesService';
import { vasKeys } from '@/lib/queryKeys/vas';
import { listValueAddedServices } from '@/lib/services/vasService';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

const LINE_KINDS: ReadonlyArray<JobTemplateLineKind> = [
  'component',
  'service',
  'step',
];

interface FormState {
  lineKind: JobTemplateLineKind;
  name: string;
  itemId: string | null;
  vasId: string | null;
  quantity: string;
  rateCents: string;
  rateUom: string;
  currencyCode: string;
}

const EMPTY_FORM: FormState = {
  lineKind: 'component',
  name: '',
  itemId: null,
  vasId: null,
  quantity: '',
  rateCents: '',
  rateUom: '',
  currencyCode: '',
};

function formStateFrom(line: JobTemplateLine): FormState {
  return {
    lineKind: line.line_kind,
    name: line.name,
    itemId: line.item_id,
    vasId: line.vas_id,
    quantity: line.quantity == null ? '' : String(line.quantity),
    rateCents: line.rate_cents == null ? '' : String(line.rate_cents),
    rateUom: line.rate_uom ?? '',
    currencyCode: line.currency_code ?? '',
  };
}

export function JobTemplateLines({ templateId }: { templateId: string }) {
  const lines = useJobTemplateLines(templateId);
  const addLine = useCreateJobTemplateLine(templateId);
  const editLine = useUpdateJobTemplateLine(templateId);
  const removeLine = useDeleteJobTemplateLine(templateId);
  const caps = useCapabilities();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Value-added services back the service-line reference. Loaded only when the
  // template has a service line to label or the form is editing one, so a
  // component/step-only template skips the fetch entirely. Shares the cache key
  // with the VAS catalog page, so a second consumer pays nothing.
  const needsVas =
    (lines.data ?? []).some((l) => l.line_kind === 'service') ||
    form.lineKind === 'service';
  const vas = useQuery({
    queryKey: vasKeys.list(),
    queryFn: () => listValueAddedServices(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: needsVas,
  });
  const vasList = vas.data ?? [];
  const vasLabel = (id: string): string => {
    const row = vasList.find((v) => v.id === id);
    return row ? `${row.code} · ${row.name}` : id;
  };

  const canCreate = caps.can('threepl.job_template.line.create');
  const canUpdate = caps.can('threepl.job_template.line.update');
  const canDelete = caps.can('threepl.job_template.line.delete');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  // Build the wire body from the form. The item / vas reference is carried only
  // for the kind that owns it; empty optionals collapse to null so the server
  // clears them. Rate is whole cents; quantity is numeric.
  const buildBody = () => ({
    line_kind: form.lineKind,
    name: form.name,
    item_id: form.lineKind === 'component' ? form.itemId : null,
    vas_id: form.lineKind === 'service' ? form.vasId : null,
    quantity: form.quantity.trim() === '' ? null : Number(form.quantity),
    rate_cents: form.rateCents.trim() === '' ? null : Number(form.rateCents),
    rate_uom: form.rateUom.trim() === '' ? null : form.rateUom.trim(),
    currency_code:
      form.currencyCode.trim() === '' ? null : form.currencyCode.trim().toUpperCase(),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body = buildBody();
    if (editingId) {
      editLine.mutate({ lineId: editingId, body }, { onSuccess: resetForm });
    } else {
      addLine.mutate(body, { onSuccess: resetForm });
    }
  };

  const onEdit = (line: JobTemplateLine) => {
    setEditingId(line.id);
    setForm(formStateFrom(line));
  };

  const onRemove = async (line: JobTemplateLine) => {
    const ok = await destructiveConfirm({
      action: 'Delete this line',
      consequence: `"${line.name}" will be removed from this job builder.`,
    });
    if (!ok) return;
    if (editingId === line.id) resetForm();
    removeLine.mutate(line.id);
  };

  const rows = lines.data ?? [];
  const pending = addLine.isPending || editLine.isPending;
  const mutationError = editingId ? editLine.error : addLine.error;

  return (
    <section>
      <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
        BUILDER LINES
      </h2>

      {lines.isLoading ? (
        <p className="text-ink-dim text-sm">Loading builder lines.</p>
      ) : lines.error ? (
        <p className="text-accent text-sm">
          {lines.error instanceof Error
            ? lines.error.message
            : 'Failed to load builder lines.'}
        </p>
      ) : rows.length === 0 ? (
        <DetailSectionEmptyCoaching
          entity="builder line"
          explainer="Builder lines define the job: the components it consumes, the services it bills, and the steps the floor runs."
          icon={Layers}
        />
      ) : (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Reference</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">UOM</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => (
              <tr key={line.id} className="border-t border-line">
                <td className="px-4 py-2 font-sans text-sm capitalize">
                  {line.line_kind}
                </td>
                <td className="px-4 py-2 font-sans text-sm text-ink">{line.name}</td>
                <td className="px-4 py-2 font-sans text-sm text-ink-dim">
                  {line.line_kind === 'component' && line.item_id ? (
                    <EntityLabel kind="item" id={line.item_id} />
                  ) : line.line_kind === 'service' && line.vas_id ? (
                    vasLabel(line.vas_id)
                  ) : (
                    ''
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm text-right">
                  {line.quantity == null ? '' : String(line.quantity)}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm text-right">
                  {line.rate_cents == null
                    ? ''
                    : formatCents(line.rate_cents, line.currency_code ?? 'USD')}
                </td>
                <td className="px-4 py-2 font-mono text-sm">{line.rate_uom ?? ''}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end">
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => onEdit(line)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        onClick={() => onRemove(line)}
                        disabled={removeLine.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removeLine.isError && (
        <p className="mt-2 text-accent font-sans text-sm">
          Remove failed:{' '}
          {removeLine.error instanceof Error
            ? removeLine.error.message
            : 'unknown error'}
        </p>
      )}

      {(canCreate || editingId) && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 border border-line p-4 mt-4">
          <h3 className="font-display tracking-wider text-ink">
            {editingId ? 'EDIT LINE' : 'ADD LINE'}
          </h3>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Kind
              </span>
              <Select
                value={form.lineKind}
                onChange={(e) => set('lineKind', e.target.value as JobTemplateLineKind)}
              >
                {LINE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
            <TextInput
              label="Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
            {form.lineKind === 'component' && (
              <ItemPicker
                value={form.itemId}
                onChange={(itemId) => set('itemId', itemId)}
                filter={{ kind: 'good' }}
                label="Item"
              />
            )}
            {form.lineKind === 'service' && (
              <label className="flex flex-col gap-2">
                <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                  Service
                </span>
                <Select
                  value={form.vasId ?? ''}
                  onChange={(e) => set('vasId', e.target.value === '' ? null : e.target.value)}
                  disabled={vas.isLoading}
                >
                  <option value="">{vas.isLoading ? 'Loading.' : 'Select a service.'}</option>
                  {vasList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} · {v.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <TextInput
              label="Quantity"
              value={form.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              inputMode="decimal"
            />
            <TextInput
              label="Rate (whole cents, e.g. 250 = $2.50)"
              value={form.rateCents}
              onChange={(e) => set('rateCents', e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="UOM"
              value={form.rateUom}
              onChange={(e) => set('rateUom', e.target.value)}
              placeholder="e.g. each, hour"
            />
            <TextInput
              label="Currency"
              value={form.currencyCode}
              onChange={(e) => set('currencyCode', e.target.value)}
              placeholder="USD"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!form.name.trim() || pending}>
              {pending ? 'Saving.' : editingId ? 'Save changes' : 'Add line'}
            </Button>
            {editingId && (
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
          {mutationError && (
            <p className="text-accent font-sans text-sm">
              {mutationError instanceof Error ? mutationError.message : 'Save failed.'}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
