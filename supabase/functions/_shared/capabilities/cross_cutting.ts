// Cross-cutting capability canon. Byte-mirror of
// apps/web/src/lib/capabilities/cross_cutting.ts.
// Shape: <domain>.<resource>.<action>. The server is authority via
// requireCap(); the SPA uses CROSS_CUTTING_CAPABILITIES_BY_ROLE only to hide
// buttons.

export type RoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export type CrossCuttingCapability =
  | 'audit_log.entry.read'
  | 'attachments.attachment.read'
  | 'attachments.attachment.create'
  | 'attachments.attachment.delete'
  | 'comments.comment.read'
  | 'comments.comment.create'
  | 'comments.comment.delete'
  | 'notifications.notification.read'
  | 'notifications.notification.update'
  | 'search.global.read'
  | 'dashboard.summary.read'
  | 'imports.job.validate'
  | 'imports.job.commit'
  | 'exports.job.create'
  | 'portal.customer.read'
  | 'portal.invoice.read'
  | 'portal.quote.read'
  | 'portal.project.read'
  | 'portal.attachment.read'
  | 'pdf.document.render';

const INTERNAL_FULL: ReadonlyArray<CrossCuttingCapability> = [
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'imports.job.validate',
  'imports.job.commit',
  'exports.job.create',
  'pdf.document.render',
];

const INTERNAL_READ: ReadonlyArray<CrossCuttingCapability> = [
  'audit_log.entry.read',
  'attachments.attachment.read',
  'comments.comment.read',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'pdf.document.render',
];

const INTERNAL_AUTHOR: ReadonlyArray<CrossCuttingCapability> = [
  ...INTERNAL_READ,
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.create',
  'comments.comment.delete',
  'exports.job.create',
];

const VIEWER_CAPS: ReadonlyArray<CrossCuttingCapability> = INTERNAL_READ;

const PORTAL_CAPS: ReadonlyArray<CrossCuttingCapability> = [
  'portal.customer.read',
  'portal.invoice.read',
  'portal.quote.read',
  'portal.project.read',
  'portal.attachment.read',
  'attachments.attachment.read',
  'pdf.document.render',
];

const VENDOR_PORTAL_CAPS: ReadonlyArray<CrossCuttingCapability> = [
  // Vendor portal is DEFERRED per AUDIT. Keep an empty matrix so the SPA
  // mirror compiles. Server gates return 404 by design.
];

export const CROSS_CUTTING_CAPABILITIES_BY_ROLE: Readonly<
  Record<RoleCode, ReadonlyArray<CrossCuttingCapability>>
> = {
  org_owner:     INTERNAL_FULL,
  org_admin:     INTERNAL_FULL,
  sales:         INTERNAL_AUTHOR,
  ops:           INTERNAL_AUTHOR,
  accounting:    INTERNAL_AUTHOR,
  viewer:        VIEWER_CAPS,
  customer_user: PORTAL_CAPS,
  vendor_user:   VENDOR_PORTAL_CAPS,
};

export function hasCrossCuttingCap(
  role: RoleCode,
  cap: CrossCuttingCapability,
): boolean {
  return CROSS_CUTTING_CAPABILITIES_BY_ROLE[role].includes(cap);
}
