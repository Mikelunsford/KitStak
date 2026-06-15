// BillingReviewCreatePage (Wave 12 Phase A7). Creates a draft billing review.
// The job run is the primary grain (the completed run being reconciled); the
// project and account links are optional and usually inferred from the run, so
// they are offered as selects for the cases where the operator reconciles at a
// coarser grain. review_number (BILL-) is allocated server-side. On success,
// route to the new review's detail page to inspect estimate vs actual and
// approve.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ProjectPicker } from '@/components/ui/pickers';
import { useCreateBillingReview } from '@/lib/hooks/useBillingReviews';
import { useJobRunsList } from '@/lib/hooks/useJobRuns';
import { useAccountsList } from '@/lib/hooks/useAccounts';
import { useCapabilities } from '@/lib/hooks/useCapabilities';

export function BillingReviewCreatePage() {
  const navigate = useNavigate();
  const create = useCreateBillingReview();
  const jobRuns = useJobRunsList();
  const accounts = useAccountsList();
  const caps = useCapabilities();

  const [jobRunId, setJobRunId] = useState<string>('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const canCreate = caps.can('threepl.billing_review.create');
  const jobRunOptions = jobRuns.data ?? [];
  const accountOptions = accounts.data ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    create.mutate(
      {
        job_run_id: jobRunId ? jobRunId : null,
        project_id: projectId,
        account_id: accountId ? accountId : null,
        notes: notes.trim() ? notes.trim() : null,
      },
      {
        onSuccess: (review) =>
          navigate(`/3pl-operations/billing-reviews/${review.id}`),
      },
    );
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="3PL Operations" title="New billing review" />

      {!canCreate ? (
        <p className="font-sans text-sm text-accent">
          You do not have permission to create billing reviews.
        </p>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 border border-line p-6"
      >
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Job run (the run being reconciled)
          </span>
          <Select
            value={jobRunId}
            onChange={(e) => setJobRunId(e.target.value)}
            disabled={jobRuns.isLoading}
          >
            <option value="">
              {jobRuns.isLoading ? 'Loading.' : 'No job run'}
            </option>
            {jobRunOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.run_number ?? r.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>

        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Account (optional)
          </span>
          <Select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={accounts.isLoading}
          >
            <option value="">
              {accounts.isLoading ? 'Loading.' : 'No account'}
            </option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_number ? `${a.account_number} · ${a.name}` : a.name}
              </option>
            ))}
          </Select>
        </label>

        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex gap-3">
          <Button type="submit" disabled={!canCreate || create.isPending}>
            {create.isPending ? 'Creating.' : 'Create billing review'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/3pl-operations/billing-reviews')}
          >
            Cancel
          </Button>
        </div>
        {create.isError && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create billing review failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
