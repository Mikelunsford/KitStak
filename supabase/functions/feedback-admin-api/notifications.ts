// feedback-admin-api notification fan-out (best-effort, platform staff ->
// tenant tester).
//
// A staff reply (non-internal) or a status change pings the ticket's original
// submitter with BOTH an in-app and an email notification. The email is
// skipped when the tester's auth email cannot be resolved; the in-app
// notification is still inserted. Every insert is best-effort: a failure is
// logged and swallowed so it never fails the staff action. See migration 0035
// for the notifications contract (subject NOT NULL, channel inapp|email|
// webhook, payload.to carries the recipient email for the email sender).

import { admin } from '../_shared/handler-helpers.ts';

interface TicketLike {
  id: string;
  org_id: string;
  reference: string | null;
  title: string;
  created_by: string | null;
}

const FEEDBACK_LINK_PREFIX = '/feedback/tickets/';

async function resolveEmail(userId: string): Promise<string | null> {
  try {
    const res = await admin().auth.admin.getUserById(userId);
    return res.data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function insertOne(
  row: Record<string, unknown>,
  ticketId: string,
  channel: string,
): Promise<void> {
  try {
    const { error } = await admin().from('notifications').insert(row);
    if (error) {
      console.error('feedback-admin-api: failed to queue tester notification', {
        ticket_id: ticketId,
        channel,
        message: error.message,
      });
    }
  } catch (e) {
    console.error('feedback-admin-api: tester notification threw', {
      ticket_id: ticketId,
      channel,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Notify the ticket's original submitter. Inserts an in-app notification
 * always, and an email notification when the tester's address resolves. The
 * org_id is the ticket's org (cross-tenant: the recipient lives in their own
 * tenant, not the staff caller's).
 */
async function notifyTester(
  ticket: TicketLike,
  subject: string,
  bodyText: string,
): Promise<void> {
  if (!ticket.created_by) return;
  const recipient = ticket.created_by;
  const link = `${FEEDBACK_LINK_PREFIX}${ticket.id}`;

  // In-app (always).
  await insertOne(
    {
      org_id: ticket.org_id,
      recipient_user_id: recipient,
      entity_type: 'support_ticket',
      entity_id: ticket.id,
      channel: 'inapp',
      subject,
      body: bodyText,
      payload: { reference: ticket.reference, link },
    },
    ticket.id,
    'inapp',
  );

  // Email (only when the address resolves).
  const email = await resolveEmail(recipient);
  if (!email) return;
  await insertOne(
    {
      org_id: ticket.org_id,
      recipient_user_id: recipient,
      entity_type: 'support_ticket',
      entity_id: ticket.id,
      channel: 'email',
      subject,
      body: bodyText,
      payload: { to: email, reference: ticket.reference, link },
    },
    ticket.id,
    'email',
  );
}

/** Notify the submitter that staff posted a public reply. */
export async function notifyTesterStaffReply(ticket: TicketLike): Promise<void> {
  const link = `${FEEDBACK_LINK_PREFIX}${ticket.id}`;
  const subject = `New reply on ${ticket.reference ?? ticket.title}`;
  const bodyText =
    `The Kitstak team replied to your feedback.\n\n` +
    `Reference: ${ticket.reference ?? '(none)'}\n` +
    `Title: ${ticket.title}\n\n` +
    `Open it here: ${link}`;
  await notifyTester(ticket, subject, bodyText);
}

/** Notify the submitter that staff changed the ticket status. */
export async function notifyTesterStatusChange(
  ticket: TicketLike,
  newStatus: string,
): Promise<void> {
  const link = `${FEEDBACK_LINK_PREFIX}${ticket.id}`;
  const subject = `Feedback ${ticket.reference ?? ticket.title} is now ${newStatus}`;
  const bodyText =
    `Your feedback status changed to "${newStatus}".\n\n` +
    `Reference: ${ticket.reference ?? '(none)'}\n` +
    `Title: ${ticket.title}\n\n` +
    `Open it here: ${link}`;
  await notifyTester(ticket, subject, bodyText);
}
