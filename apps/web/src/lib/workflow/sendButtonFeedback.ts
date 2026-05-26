// Pure helper for the Send button's pending / success / error / re-send
// states on QuoteDetailPage and InvoiceDetailPage. Closes
// F-Wave9-SEND-FEEDBACK-01: the prod smoke walk on 2026-05-21 caught the
// operator clicking Send 7 times in a row because the button rendered no
// feedback at all. The page wires its TanStack Query mutation flags plus
// the entity's `sent_at` into this helper and gets back the label, the
// disabled flag, and an optional helper-text line.
//
// Component-prop tests live alongside the helper; the repo convention is
// pure-function tests (no jsdom). The JSX renderer inlines the result.

import { formatDateMedium } from '../dates';

export interface SendButtonFeedbackInput {
  /** Mutation is in flight. From `mutation.isPending`. */
  isPending: boolean;
  /** Mutation just succeeded and the page has not re-fetched yet. */
  isSuccess: boolean;
  /** Error from the failed mutation, or null. From `mutation.error`. */
  error: unknown;
  /** Timestamp the entity was previously sent at, or null for first send. */
  sentAt: string | null;
}

export interface SendButtonFeedbackOutput {
  /** Button label. Never contains an em dash. */
  label: string;
  /** Whether the button should be disabled. */
  disabled: boolean;
  /** Microcopy under the button. Null when nothing to say. */
  helperText: string | null;
  /** Error message under the button. Null when no error. */
  errorMessage: string | null;
  /** True when the success confirmation line should render. */
  showSuccess: boolean;
}

const DEFAULT_LABEL = 'Send';
const RESEND_LABEL = 'Send again';
const PENDING_LABEL = 'Sending...';
const SENT_LABEL = 'Sent.';
const SUCCESS_LINE = 'Email queued for delivery.';
const FALLBACK_ERROR = 'Send failed.';

export function computeSendButtonFeedback(
  input: SendButtonFeedbackInput,
): SendButtonFeedbackOutput {
  const { isPending, isSuccess, error, sentAt } = input;

  if (isPending) {
    return {
      label: PENDING_LABEL,
      disabled: true,
      helperText: null,
      errorMessage: null,
      showSuccess: false,
    };
  }

  if (error) {
    return {
      label: sentAt ? RESEND_LABEL : DEFAULT_LABEL,
      disabled: false,
      helperText: null,
      errorMessage: extractErrorMessage(error),
      showSuccess: false,
    };
  }

  if (isSuccess) {
    return {
      label: SENT_LABEL,
      disabled: true,
      helperText: null,
      errorMessage: null,
      showSuccess: true,
    };
  }

  if (sentAt) {
    return {
      label: RESEND_LABEL,
      disabled: false,
      helperText: `This was already sent on ${formatDateMedium(sentAt)}.`,
      errorMessage: null,
      showSuccess: false,
    };
  }

  return {
    label: DEFAULT_LABEL,
    disabled: false,
    helperText: null,
    errorMessage: null,
    showSuccess: false,
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return FALLBACK_ERROR;
}

export const SEND_FEEDBACK_COPY = {
  successLine: SUCCESS_LINE,
  pendingLabel: PENDING_LABEL,
  sentLabel: SENT_LABEL,
  defaultLabel: DEFAULT_LABEL,
  resendLabel: RESEND_LABEL,
  fallbackError: FALLBACK_ERROR,
};
