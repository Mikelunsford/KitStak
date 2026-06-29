// Job Builder (ADR 0006 P2c): turn an approved quote into a buildable job. The
// list lives at /3pl-operations/job-builder; one run's builder at /:id. A single
// route component switches on the param so both share the lazy chunk.

import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { useJobRunsList } from '@/lib/hooks/useJobRuns';
import { JobBuilderList } from './JobBuilderList';
import { JobBuilderDetail } from './JobBuilderDetail';

export function JobBuilderPage() {
  const { id } = useParams();
  if (id) return <JobBuilderDetail runId={id} />;
  return <JobBuilderListView />;
}

function JobBuilderListView() {
  const { data, isLoading } = useJobRunsList();
  const runs = data ?? [];
  const meta = !isLoading
    ? `${runs.length} ${runs.length === 1 ? 'job' : 'jobs'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader title="Job Builder" meta={meta} />
      {isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading jobs.</p>
      ) : (
        <JobBuilderList runs={runs} />
      )}
    </section>
  );
}
