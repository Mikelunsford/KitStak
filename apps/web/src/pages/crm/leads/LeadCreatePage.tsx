import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { leadsKeys } from '@/lib/queryKeys/leads';
import { createLead } from '@/lib/services/leadsService';
import {
  LeadCreateSchema,
  LeadSourceSchema,
  type Lead,
  type LeadCreate,
  type LeadSource,
} from '@/lib/types/crm';

/**
 * LeadCreatePage. Closes G-LEAD-FORM-01.
 *
 * Wave 2 shipped LeadsKanbanPage + LeadDetailPage + LeadConvertPage but no
 * create form. Operator landing on /crm/leads had nowhere to begin the chain.
 * This page captures the columns LeadCreateSchema accepts: a required
 * display_name (the lead's company or person name), an optional company_name,
 * a source enum, contact email and phone, and free-form notes. status defaults
 * to 'new' per the schema default.
 */
export function LeadCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [source, setSource] = useState<LeadSource>('inbound');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: LeadCreate) => createLead(body),
    onSuccess: (created: Lead) => {
      void qc.invalidateQueries({ queryKey: leadsKeys.all });
      navigate(`/crm/leads/${created.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save lead.'),
  });

  const sources: LeadSource[] = [...LeadSourceSchema.options];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // display_name is required by the schema; fall back to contact name when
    // the operator only filled in the contact, but prefer company_name so the
    // kanban card surfaces the company the lead belongs to.
    const draftDisplayName = companyName.trim() || contactName.trim();
    const draft = {
      display_name: draftDisplayName,
      company_name: companyName.trim() || undefined,
      source,
      primary_email: contactEmail.trim() || undefined,
      primary_phone: contactPhone.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    const parsed = LeadCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW LEAD</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Company name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
        />
        <TextInput
          label="Contact name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="Optional"
        />
        <TextInput
          label="Contact email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="Optional"
        />
        <TextInput
          label="Contact phone"
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="Optional"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Source
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSource)}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          >
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {error && <p className="text-accent font-sans text-sm">{error}</p>}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving.' : 'Save lead'}
        </Button>
      </form>
    </section>
  );
}
