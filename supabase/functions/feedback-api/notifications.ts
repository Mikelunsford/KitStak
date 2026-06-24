// feedback-api notification fan-out (best-effort, tenant -> platform staff).
//
// A new ticket or a new tenant reply pings every platform_staff operator with
// a queued email notification (drained by notifications-worker). Every insert
// here is best-effort: a failure is logged and swallowed so it never fails the
// caller's create. See migration 0035 for the notifications table contract
// (subject NOT NULL, channel in inapp|email|webhook, payload.to carries the
// recipient email for the email sender).

import { admin } from '../_shared/handler-helpers.ts';

interface TicketLike {
  id: string;
  org_id: string;
  reference: string | null;
  title: string;
  type: string;
}

interface StaffRecipient {
  userId: string;
  email: string | null;
}

const FEEDBACK_LINK_PREFIX = '/feedback/tickets/';

/**
 * Resolve the platform_staff allowlist and their auth emails. Returns an empty
 * list (never throws) so the caller's main request is never coupled to a
 * notification lookup failure.
 */
async function resolveStaffRecipients(): Promise<StaffRecipient[]> {
  try {
    const sb = admin();
    const { data, error } = await sb
      .from('platform_staff')
      .select('user_id');
    if (error || !data) return [];

    const out: StaffRecipient[] = [];
    for (const row of data as Array<{ user_id: string }>) {
      let email: string | null = null;
      try {
        const res = await sb.auth.admin.getUserById(row.user_id);
        email = res.data?.user?.email ?? null;
      } catch {
        email = null;
      }
      out.push({ userId: row.user_id, email });
    }
    return out;
  } catch {
    return [];
  }
}

async function queueStaffEmail(
  ticket: TicketLike,
  staff: StaffRecipient,
  subject: string,
  bodyText: string,
): Promise<void> {
  // No email address -> nothing the email sender can deliver. Skip silently.
  if (!staff.email) return;
  try {
    const { error } = await admin().from('notifications').insert({
      org_id: ticket.org_id,
      recipient_user_id: staff.userId,
      entity_type: 'support_ticket',
      entity_id: ticket.id,
      channel: 'email',
      subject,
      body: bodyText,
      payload: {
        to: staff.email,
        reference: ticket.reference,
        type: ticket.type,
        link: `${FEEDBACK_LINK_PREFIX}${ticket.id}`,
      },
    });
    if (error) {
      console.error('feedback-api: failed to queue staff notification', {
        ticket_id: ticket.id,
        recipient_user_id: staff.userId,
        message: error.message,
      });
    }
  } catch (e) {
    console.error('feedback-api: staff notification threw', {
      ticket_id: ticket.id,
      recipient_user_id: staff.userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Ping every platform-staff operator about a newly filed ticket. */
export async function notifyStaffNewTicket(ticket: TicketLike): Promise<void> {
  const recipients = await resolveStaffRecipients();
  const subject = `New feedback: ${ticket.title}`;
  const link = `${FEEDBACK_LINK_PREFIX}${ticket.id}`;
  const bodyText =
    `A new ${ticket.type} was filed.\n\n` +
    `Reference: ${ticket.reference ?? '(none)'}\n` +
    `Title: ${ticket.title}\n\n` +
    `Open it here: ${link}`;
  for (const staff of recipients) {
    await queueStaffEmail(ticket, staff, subject, bodyText);
  }
}

/** Ping every platform-staff operator about a new tenant reply. */
export async function notifyStaffNewReply(ticket: TicketLike): Promise<void> {
  const recipients = await resolveStaffRecipients();
  const subject = `New reply on ${ticket.reference ?? ticket.title}`;
  const link = `${FEEDBACK_LINK_PREFIX}${ticket.id}`;
  const bodyText =
    `A tenant posted a new reply.\n\n` +
    `Reference: ${ticket.reference ?? '(none)'}\n` +
    `Title: ${ticket.title}\n\n` +
    `Open it here: ${link}`;
  for (const staff of recipients) {
    await queueStaffEmail(ticket, staff, subject, bodyText);
  }
}
