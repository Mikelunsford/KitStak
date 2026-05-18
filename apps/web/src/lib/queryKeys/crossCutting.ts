// Query keys for cross-cutting surfaces. One module so dependents have a
// single import path.

export const attachmentsKeys = {
  all: ['attachments'] as const,
  list: (entityType: string, entityId: string) =>
    ['attachments', entityType, entityId] as const,
};

export const commentsKeys = {
  all: ['comments'] as const,
  list: (entityType: string, entityId: string) =>
    ['comments', entityType, entityId] as const,
};

export const notificationsKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
};

export const savedViewsKeys = {
  all: ['saved_views'] as const,
  list: (entityType: string) => ['saved_views', entityType] as const,
};

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => ['search', q] as const,
};

export const dashboardKeys = {
  summary: () => ['dashboard', 'summary'] as const,
};

export const portalKeys = {
  me: () => ['portal', 'me'] as const,
  invoices: () => ['portal', 'invoices'] as const,
  quotes: () => ['portal', 'quotes'] as const,
  projects: () => ['portal', 'projects'] as const,
  attachments: (entityType: string, entityId: string) =>
    ['portal', 'attachments', entityType, entityId] as const,
};

export const pdfKeys = {
  templates: () => ['pdf', 'templates'] as const,
};

export const auditKeys = {
  list: (entityType: string, entityId: string) =>
    ['audit_log', entityType, entityId] as const,
};
