// AdminFeedbackTicketPage. The platform-staff view of one support ticket
// (feedback-admin-api). Gated by useIsPlatformStaff() like the inbox. Shows the
// full thread INCLUDING internal notes (visually distinguished), status and
// priority controls (Select -> useUpdateTicketStaff), and a reply box with an
// "internal note" checkbox (useAddStaffComment with is_internal). The server is
// the authority; this surface only renders for staff and posts staff actions.

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DetailLayout } from '@/components/ui/DetailLayout';
import {
  useIsPlatformStaff,
  useStaffTicket,
  useStaffTicketComments,
  useUpdateTicketStaff,
  useAddStaffComment,
} from '@/lib/hooks/useFeedback';
import {
  SupportTicketStatusSchema,
  SupportTicketPrioritySchema,
  SupportTicketStaffCommentCreateSchema,
  type SupportTicketComment,
  type SupportTicketStatus,
  type SupportTicketPriority,
  type SupportTicketType,
  type SupportTicketContext,
} from '@/lib/types/feedback';

const TYPE_LABEL: Record<SupportTicketType, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  question: 'Question',
};

const CONTEXT_LABEL: Record<string, string> = {
  route: 'Route',
  app_version: 'App version',
  commit: 'Commit',
  user_agent: 'User agent',
  org_name: 'Org',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function StaffCommentRow({ comment }: { comment: SupportTicketComment }) {
  const isStaff = comment.author_kind === 'platform_staff';
  const author = isStaff ? 'Staff' : 'Tester';
  return (
    <li
      className={
        comment.is_internal
          ? 'flex flex-col gap-1 border border-yellow-500/40 bg-yellow-500/5 px-4 py-3'
          : 'flex flex-col gap-1 border border-line bg-bg-2 px-4 py-3'
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-sans text-sm font-medium text-ink">
          {author}
          {comment.is_internal ? (
            <span className="ml-2 font-sans text-xs uppercase tracking-wide text-yellow-600">
              Internal note
            </span>
          ) : null}
        </span>
        <span className="font-sans text-xs tabular-nums text-ink-dim">
          {formatDateTime(comment.created_at)}
        </span>
      </div>
      <p className="whitespace-pre-wrap font-sans text-sm text-ink">
        {comment.body}
      </p>
    </li>
  );
}

function ContextPanel({ context }: { context: SupportTicketContext }) {
  const entries = Object.entries(context).filter(
    ([, v]) => typeof v === 'string' && v.length > 0,
  );
  if (entries.length === 0) {
    return (
      <p className="font-sans text-sm text-ink-dim">No context captured.</p>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-2 font-sans text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col">
          <dt className="text-ink-dim">{CONTEXT_LABEL[key] ?? key}</dt>
          <dd className="break-words text-ink">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminFeedbackTicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = id ?? '';
  const staff = useIsPlatformStaff();
  const ticket = useStaffTicket(id);
  const comments = useStaffTicketComments(id);
  const update = useUpdateTicketStaff(ticketId);
  const addComment = useAddStaffComment(ticketId);

  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (staff.isLoading || ticket.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (!staff.data) {
    return (
      <section className="mx-auto max-w-3xl px-8 py-12">
        <PageHeader title="Feedback ticket" />
        <p className="mt-4 font-sans text-sm text-ink-dim">Not authorized.</p>
      </section>
    );
  }
  if (ticket.error || !ticket.data) {
    return <p className="px-8 py-12 text-accent">Ticket not found.</p>;
  }
  const t = ticket.data;
  const thread = comments.data ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = SupportTicketStaffCommentCreateSchema.safeParse({
      body: reply.trim(),
      ...(isInternal ? { is_internal: true } : {}),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? 'Write a reply and try again.',
      );
      return;
    }
    addComment.mutate(parsed.data, {
      onSuccess: () => {
        setReply('');
        setIsInternal(false);
      },
    });
  };

  const updateError =
    update.error instanceof Error ? update.error.message : null;
  const addError =
    addComment.error instanceof Error ? addComment.error.message : null;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <p className="font-sans text-sm">
        <Link to="/admin/feedback" className="text-ink-dim hover:text-accent">
          Back to feedback inbox
        </Link>
      </p>

      <PageHeader
        title={t.title}
        meta={
          <span className="flex items-center gap-3">
            <StatusBadge status={t.status} />
            <span className="text-ink-dim">{TYPE_LABEL[t.type]}</span>
            {t.org_name ? (
              <span className="text-ink-dim">{t.org_name}</span>
            ) : null}
          </span>
        }
      />

      <DetailLayout
        rail={
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-2xl tracking-wide text-ink">
                TRIAGE
              </h2>
              <label className="flex flex-col gap-1">
                <span className="font-sans text-sm text-ink-dim">Status</span>
                <Select
                  value={t.status}
                  onChange={(e) =>
                    update.mutate({
                      status: e.target.value as SupportTicketStatus,
                    })
                  }
                  disabled={update.isPending}
                  aria-label="Ticket status"
                >
                  {SupportTicketStatusSchema.options.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-sans text-sm text-ink-dim">Priority</span>
                <Select
                  value={t.priority ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    update.mutate({
                      priority:
                        v === '' ? null : (v as SupportTicketPriority),
                    });
                  }}
                  disabled={update.isPending}
                  aria-label="Ticket priority"
                >
                  <option value="">No priority</option>
                  {SupportTicketPrioritySchema.options.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </label>
              {updateError ? (
                <p className="font-sans text-sm text-accent">{updateError}</p>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="font-display text-2xl tracking-wide text-ink">
                CONTEXT
              </h2>
              <ContextPanel context={t.context} />
            </section>
          </div>
        }
      >
        <article className="flex flex-col gap-3 border border-line bg-bg-2 px-4 py-4">
          <p className="whitespace-pre-wrap font-sans text-sm text-ink">
            {t.body}
          </p>
          {t.reference ? (
            <p className="font-sans text-sm text-ink-dim">
              Reference{' '}
              <span className="tabular-nums text-ink">{t.reference}</span>
            </p>
          ) : null}
          {t.created_by_email ? (
            <p className="font-sans text-sm text-ink-dim">
              From{' '}
              <span className="text-ink">{t.created_by_email}</span>
            </p>
          ) : null}
        </article>

        <section className="mt-6 flex flex-col gap-3">
          <h2 className="font-display text-2xl tracking-wide text-ink">
            THREAD
          </h2>
          {comments.isLoading ? (
            <p className="font-sans text-sm text-ink-dim">Loading thread.</p>
          ) : thread.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">No replies yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {thread.map((c) => (
                <StaffCommentRow key={c.id} comment={c} />
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="font-sans text-sm tracking-wide text-ink-dim">
              Add a reply
            </span>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              maxLength={10000}
              placeholder="Reply to the tester, or leave an internal note."
              className="border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 font-sans text-sm text-ink">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
            />
            Internal note (not visible to the tester)
          </label>
          <div>
            <Button
              type="submit"
              disabled={addComment.isPending || reply.trim() === ''}
            >
              {addComment.isPending
                ? 'Sending.'
                : isInternal
                  ? 'Save internal note'
                  : 'Send reply'}
            </Button>
          </div>
          {formError ? (
            <p className="font-sans text-sm text-accent">{formError}</p>
          ) : null}
          {addError ? (
            <p className="font-sans text-sm text-accent">{addError}</p>
          ) : null}
        </form>
      </DetailLayout>
    </section>
  );
}
