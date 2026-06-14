// Wave 12 / A3 (3PL quote integration). The "apply template" control on the
// quote detail page: pick an active Job Builder template, preview what it adds,
// and expand its lines onto the draft quote. Extracted from QuoteDetailPage so
// the detail page stays focused; the orchestration lives in
// useApplyTemplateToQuote and the line mapping in lib/quotes/applyJobTemplate.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import {
  useJobTemplatesList,
  useJobTemplateLines,
} from '@/lib/hooks/useJobTemplates';
import { useApplyTemplateToQuote } from '@/lib/hooks/useQuotes';

interface ApplyTemplatePanelProps {
  quoteId: string;
  // Next free line position on the quote; template lines append after it.
  basePosition: number;
}

export function ApplyTemplatePanel({ quoteId, basePosition }: ApplyTemplatePanelProps) {
  const [templateId, setTemplateId] = useState('');
  const templates = useJobTemplatesList({ status: 'active' });
  const lines = useJobTemplateLines(templateId || undefined);
  const apply = useApplyTemplateToQuote(quoteId);

  const templateList = templates.data ?? [];
  const selected = templateList.find((t) => t.id === templateId) ?? null;
  const lineList = lines.data ?? [];

  const onApply = () => {
    if (!selected) return;
    apply.mutate(
      { template: selected, lines: lineList, basePosition },
      { onSuccess: () => setTemplateId('') },
    );
  };

  return (
    <section className="flex flex-col gap-3 border border-line p-4">
      <h3 className="font-display tracking-wider text-ink">APPLY TEMPLATE</h3>
      <p className="font-sans text-sm text-ink-dim">
        Expand a Job Builder template into quote lines. Component, service, and
        priced step lines carry their rate; unpriced steps become notes.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Template
          </span>
          <Select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={templates.isLoading}
          >
            <option value="">
              {templates.isLoading ? 'Loading.' : 'Select a template'}
            </option>
            {templateList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.template_number ? `${t.template_number} ` : ''}
                {t.name}
              </option>
            ))}
          </Select>
        </label>
        <Button
          onClick={onApply}
          disabled={!selected || lines.isLoading || apply.isPending}
        >
          {apply.isPending ? 'Applying.' : 'Apply template'}
        </Button>
      </div>

      {selected && (
        <p className="font-sans text-sm text-ink-dim">
          {lines.isLoading ? (
            'Loading template lines.'
          ) : (
            <>
              Adds {lineList.length} line{lineList.length === 1 ? '' : 's'}
              {selected.job_type_id
                ? ' and sets the job type from the template.'
                : '.'}
            </>
          )}
        </p>
      )}

      {apply.isSuccess && apply.data && (
        <p className="font-sans text-sm text-ink-dim">
          Added {apply.data.added} of {apply.data.total} lines.
        </p>
      )}
      {apply.error && (
        <p className="font-sans text-sm text-accent">
          {apply.error instanceof Error
            ? apply.error.message
            : 'Apply template failed.'}
        </p>
      )}
    </section>
  );
}
