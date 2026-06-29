// Labels tab: the run-scoped job_run_labels, each capturing the customer data
// printed on it. CRUD against the artifact hooks. Uses hooks (mutations), so it
// is not element-tree-walk tested; the pure label field map lives in jobModel.
// ADR 0006 P2c.

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import {
  useCreateJobRunLabel,
  usePatchJobRunLabel,
  useDeleteJobRunLabel,
} from '@/lib/hooks/useJobArtifacts';
import {
  LABEL_KINDS,
  LABEL_SIZES,
  labelFieldsFor,
} from '@/lib/jobbuilder/jobModel';
import type { JobRunLabel } from '@/lib/types/jobbuilder';

const INPUT =
  'bg-bg-2 border border-line text-ink px-2 py-1.5 font-sans text-sm focus:outline-none focus:border-accent';

export function LabelsTab({ runId, labels }: { runId: string; labels: JobRunLabel[] }) {
  const create = useCreateJobRunLabel(runId);
  const patch = usePatchJobRunLabel(runId);
  const remove = useDeleteJobRunLabel(runId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg tracking-wide text-ink">Labels</h3>
          <p className="font-sans text-sm text-ink-dim">
            Each label captures the customer-supplied data printed on it.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => create.mutate({ label_kind: 'UPC', size: '4x6', data: {}, qty: 0 })}
          disabled={create.isPending}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Add label
          </span>
        </Button>
      </div>

      {labels.length === 0 ? (
        <p className="border border-line bg-bg-2 px-4 py-6 text-center font-sans text-sm text-ink-faint">
          No labels yet.
        </p>
      ) : (
        labels.map((lb) => (
          <div key={lb.id} className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Type</span>
                  <Select
                    value={lb.label_kind}
                    onChange={(e) => patch.mutate({ labelId: lb.id, input: { label_kind: e.target.value, data: {} } })}
                  >
                    {LABEL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Size</span>
                  <Select
                    value={lb.size ?? ''}
                    onChange={(e) => patch.mutate({ labelId: lb.id, input: { size: e.target.value } })}
                  >
                    {LABEL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Qty</span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={lb.qty}
                    onBlur={(e) => {
                      const qty = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                      if (qty !== lb.qty) patch.mutate({ labelId: lb.id, input: { qty } });
                    }}
                    className={`${INPUT} w-24 text-right tabular-nums`}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(lb.id)}
                title="Remove label"
                className="text-ink-faint hover:text-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {labelFieldsFor(lb.label_kind).map((f) => (
                <label key={`${lb.id}-${f.key}`} className="flex flex-col gap-1.5">
                  <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">{f.label}</span>
                  <input
                    type={f.type ?? 'text'}
                    defaultValue={lb.data[f.key] ?? ''}
                    placeholder={f.ph}
                    onBlur={(e) => {
                      const value = e.target.value;
                      if (value !== (lb.data[f.key] ?? '')) {
                        patch.mutate({ labelId: lb.id, input: { data: { ...lb.data, [f.key]: value } } });
                      }
                    }}
                    className={INPUT}
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
