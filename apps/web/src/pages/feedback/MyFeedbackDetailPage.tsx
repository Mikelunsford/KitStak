// MyFeedbackDetailPage. A tester's single support ticket (feedback-api): the
// header (title, status, type, reference), the original body, the two-way
// comment thread (internal staff notes are filtered out server-side), and a
// reply box. The tester never changes status here; that is the staff surface.

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Disclosure } from '@/components/ui/Disclosure';
import {
  useTicket,
  useTicketComments,
  useAddComment,
} from '@/lib/hooks/useFeedback';
import {
  SupportTicketCommentCreateSchema,
  type SupportTicketComment,
  type SupportTicketType,
} from '@/lib/types/feedback';

const TYPE_LABEL: Record<SupportTicketType, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  question: 'Question',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function CommentRow({ comment }: { comment: SupportTicketComment }) {
  const isStaff = comment.author_kind === 'platform_staff';
  return (
    <li className="flex flex-col gap-1 border border-line bg-bg-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-sans text-sm font-medium text-ink">
          {isStaff ? 'Kitstak team' : 'You'}
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

export function MyFeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = id ?? '';
  const ticket = useTicket(id);
  const comments = useTicketComments(id);
  const addComment = useAddComment(ticketId);

  const [reply, setReply] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  if (ticket.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (ticket.error || !ticket.data) {
    return <p className="px-8 py-12 text-accent">Ticket not found.</p>;
  }
  const t = ticket.data;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = SupportTicketCommentCreateSchema.safeParse({
      body: reply.trim(),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? 'Write a reply and try again.',
      );
      return;
    }
    addComment.mutate(parsed.data, {
      onSuccess: () => setReply(''),
    });
  };

  const thread = comments.data ?? [];
  const addError =
    addComment.error instanceof Error ? addComment.error.message : null;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
      <p className="font-sans text-sm">
        <Link
          to="/feedback/tickets"
          className="text-ink-dim hover:text-accent"
        >
          Back to feedback
        </Link>
      </p>

      <PageHeader
        title={t.title}
        meta={
          <span className="flex items-center gap-3">
            <StatusBadge status={t.status} />
            <span className="text-ink-dim">{TYPE_LABEL[t.type]}</span>
          </span>
        }
      />

      <article className="flex flex-col gap-3 border border-line bg-bg-2 px-4 py-4">
        <p className="whitespace-pre-wrap font-sans text-sm text-ink">
          {t.body}
        </p>
        {t.reference ? (
          <Disclosure label="Additional details">
            <p className="font-sans text-sm text-ink-dim">
              Reference{' '}
              <span className="tabular-nums text-ink">{t.reference}</span>
            </p>
          </Disclosure>
        ) : null}
      </article>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl tracking-wide text-ink">REPLIES</h2>
        {comments.isLoading ? (
          <p className="font-sans text-sm text-ink-dim">Loading replies.</p>
        ) : thread.length === 0 ? (
          <p className="font-sans text-sm text-ink-dim">
            No replies yet. Add one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {thread.map((c) => (
              <CommentRow key={c.id} comment={c} />
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm tracking-wide text-ink-dim">
            Add a reply
          </span>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            maxLength={10000}
            placeholder="Add more detail or answer a question."
            className="border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <div>
          <Button
            type="submit"
            disabled={addComment.isPending || reply.trim() === ''}
          >
            {addComment.isPending ? 'Sending.' : 'Send reply'}
          </Button>
        </div>
        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {addError && <p className="font-sans text-sm text-accent">{addError}</p>}
      </form>
    </section>
  );
}
