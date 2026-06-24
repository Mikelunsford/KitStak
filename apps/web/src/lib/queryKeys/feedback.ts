// Query key factory for the internal feedback / support-ticketing surfaces
// (migration 0140). Two roots under one 'feedback' namespace: the tenant side
// (a tester's own tickets, served by feedback-api) and the staff side (the
// cross-tenant inbox, served by feedback-admin-api and gated by
// is_platform_staff()). The platformStaff key backs useIsPlatformStaff().

export const feedbackKeys = {
  all: ['feedback'] as const,

  // Tenant side (feedback-api).
  myTickets: (filter?: Record<string, unknown>) =>
    ['feedback', 'tickets', 'list', filter ?? {}] as const,
  ticket: (id: string) => ['feedback', 'tickets', 'detail', id] as const,
  ticketComments: (id: string) =>
    ['feedback', 'tickets', 'comments', id] as const,

  // Staff side (feedback-admin-api).
  platformStaff: ['feedback', 'platform-staff'] as const,
  staffTickets: (filter?: Record<string, unknown>) =>
    ['feedback', 'staff', 'tickets', 'list', filter ?? {}] as const,
  staffTicket: (id: string) =>
    ['feedback', 'staff', 'tickets', 'detail', id] as const,
  staffTicketComments: (id: string) =>
    ['feedback', 'staff', 'tickets', 'comments', id] as const,
};
