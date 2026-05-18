import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { leadsKeys } from '@/lib/queryKeys/leads';
import { getLead } from '@/lib/services/leadsService';

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: id ? leadsKeys.detail(id) : ['crm', 'leads', 'detail', 'noop'],
    queryFn: () => getLead(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Lead not found.</p>;
  }
  const l = query.data;
  return (
    <section className="px-8 py-10 max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {l.display_name.toUpperCase()}
        </h1>
        {l.status === 'qualified' ? (
          <Link
            to={`/crm/leads/${l.id}/convert`}
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider"
          >
            CONVERT
          </Link>
        ) : null}
      </header>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Status</dt>
        <dd>{l.status}</dd>
        <dt className="text-ink-dim">Company</dt>
        <dd>{l.company_name ?? ''}</dd>
        <dt className="text-ink-dim">Source</dt>
        <dd>{l.source ?? ''}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd>{l.primary_email ?? ''}</dd>
        <dt className="text-ink-dim">Estimated value (cents)</dt>
        <dd>{l.estimated_value_cents}</dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd>{l.currency_code ?? ''}</dd>
        <dt className="text-ink-dim">Converted customer id</dt>
        <dd>{l.converted_customer_id ?? ''}</dd>
        <dt className="text-ink-dim">Converted opportunity id</dt>
        <dd>{l.converted_opportunity_id ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="lead" entityId={id ?? null} />
      </section>
    </section>
  );
}
