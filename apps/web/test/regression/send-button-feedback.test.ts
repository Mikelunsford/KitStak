// Regression suite for F-Wave9-SEND-FEEDBACK-01. The Send button on
// QuoteDetailPage and InvoiceDetailPage must render pending, success, and
// error states inline so the operator never has to guess whether their
// click landed. The 2026-05-21 prod smoke walk surfaced the operator
// clicking Send 7 times in a row because the original wiring fired the
// mutation but rendered no feedback at all.
//
// Pure-function test (no jsdom), in line with the repo convention. The
// JSX renderer for both pages calls computeSendButtonFeedback and inlines
// the result; if the helper drifts, both pages regress in lockstep.

import { describe, it, expect } from 'vitest';

import {
  computeSendButtonFeedback,
  SEND_FEEDBACK_COPY,
} from '../../src/lib/workflow/sendButtonFeedback';

describe('computeSendButtonFeedback', () => {
  const baseInput = {
    isPending: false,
    isSuccess: false,
    error: null,
    sentAt: null,
  };

  describe('idle state (first send)', () => {
    it('renders the default label and is enabled', () => {
      const result = computeSendButtonFeedback(baseInput);
      expect(result.label).toBe(SEND_FEEDBACK_COPY.defaultLabel);
      expect(result.disabled).toBe(false);
      expect(result.helperText).toBeNull();
      expect(result.errorMessage).toBeNull();
      expect(result.showSuccess).toBe(false);
    });
  });

  describe('pending state', () => {
    it('disables the button and switches to the pending label', () => {
      const result = computeSendButtonFeedback({ ...baseInput, isPending: true });
      expect(result.label).toBe(SEND_FEEDBACK_COPY.pendingLabel);
      expect(result.disabled).toBe(true);
      expect(result.errorMessage).toBeNull();
      expect(result.showSuccess).toBe(false);
    });

    it('uses three trailing dots, not an em dash, per constitutional copy rules', () => {
      const result = computeSendButtonFeedback({ ...baseInput, isPending: true });
      expect(result.label.endsWith('...')).toBe(true);
      expect(result.label.includes('—')).toBe(false);
      expect(result.label.includes('--')).toBe(false);
    });

    it('takes priority over both error and success when mutation is still in flight', () => {
      const result = computeSendButtonFeedback({
        isPending: true,
        isSuccess: true,
        error: new Error('stale'),
        sentAt: '2026-05-20T10:00:00.000Z',
      });
      expect(result.label).toBe(SEND_FEEDBACK_COPY.pendingLabel);
      expect(result.disabled).toBe(true);
      expect(result.errorMessage).toBeNull();
      expect(result.showSuccess).toBe(false);
    });
  });

  describe('success state', () => {
    it('disables the button, switches to the sent label, and shows the success line', () => {
      const result = computeSendButtonFeedback({ ...baseInput, isSuccess: true });
      expect(result.label).toBe(SEND_FEEDBACK_COPY.sentLabel);
      expect(result.disabled).toBe(true);
      expect(result.showSuccess).toBe(true);
      expect(result.errorMessage).toBeNull();
    });
  });

  describe('error state', () => {
    it('surfaces the actual mutation error message', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        error: new Error('SMTP relay refused the message.'),
      });
      expect(result.errorMessage).toBe('SMTP relay refused the message.');
      expect(result.disabled).toBe(false);
      expect(result.showSuccess).toBe(false);
    });

    it('falls back to a generic message when the error has no usable message', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        error: {},
      });
      expect(result.errorMessage).toBe(SEND_FEEDBACK_COPY.fallbackError);
    });

    it('accepts a plain string error', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        error: 'Network unreachable.',
      });
      expect(result.errorMessage).toBe('Network unreachable.');
    });

    it('relabels to "Send again" when the entity already had sent_at', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        error: new Error('Resend failed.'),
        sentAt: '2026-05-20T10:00:00.000Z',
      });
      expect(result.label).toBe(SEND_FEEDBACK_COPY.resendLabel);
      expect(result.disabled).toBe(false);
    });
  });

  describe('re-send state (entity already sent, no mutation in flight)', () => {
    it('dims to "Send again" and renders helper microcopy with the prior send date', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        sentAt: '2026-05-20T10:00:00.000Z',
      });
      expect(result.label).toBe(SEND_FEEDBACK_COPY.resendLabel);
      expect(result.disabled).toBe(false);
      expect(result.helperText).not.toBeNull();
      expect(result.helperText).toContain('already sent on');
      // The formatter renders the month name, so the rendered date contains
      // a 3-letter month code. The exact day depends on the runtime's tz,
      // but the year is stable.
      expect(result.helperText).toContain('2026');
    });

    it('does not render the success confirmation line', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        sentAt: '2026-05-20T10:00:00.000Z',
      });
      expect(result.showSuccess).toBe(false);
    });

    it('helper text contains no em dash, double hyphen, or emoji', () => {
      const result = computeSendButtonFeedback({
        ...baseInput,
        sentAt: '2026-05-20T10:00:00.000Z',
      });
      expect(result.helperText ?? '').not.toContain('—');
      expect(result.helperText ?? '').not.toContain('--');
    });
  });

  describe('copy constants', () => {
    it('success line contains no em dash, double hyphen, or emoji', () => {
      expect(SEND_FEEDBACK_COPY.successLine).not.toContain('—');
      expect(SEND_FEEDBACK_COPY.successLine).not.toContain('--');
    });

    it('all labels stay under the disciplined brand voice (no em dash, no double hyphen)', () => {
      const labels = [
        SEND_FEEDBACK_COPY.defaultLabel,
        SEND_FEEDBACK_COPY.pendingLabel,
        SEND_FEEDBACK_COPY.sentLabel,
        SEND_FEEDBACK_COPY.resendLabel,
        SEND_FEEDBACK_COPY.fallbackError,
      ];
      for (const label of labels) {
        expect(label).not.toContain('—');
        expect(label).not.toContain('--');
      }
    });
  });
});
