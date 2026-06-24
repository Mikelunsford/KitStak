// SendFeedbackModal. The persistent "Send feedback" affordance opens this from
// the app shell topbar (visible to any authenticated tenant user). The tester
// picks a type (bug, suggestion, question), writes a title and body, and files.
//
// Context is captured silently on submit, never asked for: the current route,
// the browser user-agent, the app version and commit the tester is on (build
// constants from vite.config.ts), and the active org name when known. An
// operator triaging the staff inbox then sees exactly what build a report came
// from. Form state is plain useState plus a Zod safeParse against the canon
// SupportTicketCreateSchema (no react-hook-form, per the constitution).

import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/auth/AuthContext';
import { useMe } from '@/lib/hooks/useMe';
import { useCreateTicket } from '@/lib/hooks/useFeedback';
import {
  SupportTicketCreateSchema,
  type SupportTicketContext,
  type SupportTicketType,
} from '@/lib/types/feedback';

export interface SendFeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: SupportTicketType; label: string }> =
  [
    { value: 'bug', label: 'Bug' },
    { value: 'suggestion', label: 'Suggestion' },
    { value: 'question', label: 'Question' },
  ];

export function SendFeedbackModal({
  open,
  onClose,
}: SendFeedbackModalProps): JSX.Element | null {
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
  const create = useCreateTicket();
  const { pathname } = useLocation();

  const [type, setType] = useState<SupportTicketType>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType('bug');
    setTitle('');
    setBody('');
    setFormError(null);
    setSubmitted(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pending = create.isPending;
  const mutationError =
    create.error instanceof Error ? create.error.message : null;

  // Build the silent context. exactOptionalPropertyTypes: only attach a key
  // when we actually have a value, never set it to undefined.
  function captureContext(): SupportTicketContext {
    const activeOrgId = me.data?.active_org_id ?? null;
    const orgName = me.data?.memberships.find(
      (m) => m.org_id === activeOrgId,
    )?.display_name;
    return {
      route: pathname,
      user_agent: navigator.userAgent,
      app_version: __APP_VERSION__,
      commit: __BUILD_COMMIT__,
      ...(orgName ? { org_name: orgName } : {}),
    };
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = SupportTicketCreateSchema.safeParse({
      type,
      title: title.trim(),
      body: body.trim(),
      context: captureContext(),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? 'Check the form and try again.',
      );
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: () => {
        setSubmitted(true);
      },
    });
  };

  if (submitted) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Thank you"
        footer={
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className="font-sans text-sm text-ink">
          Your feedback is on its way to the team. We read every report.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send feedback"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="send-feedback-form"
            disabled={pending || title.trim() === '' || body.trim() === ''}
          >
            {pending ? 'Sending.' : 'Send feedback'}
          </Button>
        </>
      }
    >
      <form
        id="send-feedback-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm tracking-wide text-ink-dim">
            Type
          </span>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as SupportTicketType)}
            aria-label="Feedback type"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>

        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A short summary"
          maxLength={200}
          required
          autoFocus
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm tracking-wide text-ink-dim">
            Details
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={10000}
            placeholder="What happened, or what would help."
            className="border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
            required
          />
        </label>

        {formError && (
          <p className="font-sans text-sm text-danger">{formError}</p>
        )}
        {mutationError && (
          <p className="font-sans text-sm text-danger">{mutationError}</p>
        )}
      </form>
    </Modal>
  );
}
